import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { makeThumb, processPhoto } from "@/lib/images";
import { getPublicBytes, publicUrl, putOriginal, putPublic } from "@/lib/storage";
import { captureTime, sameSecondCounter, wallClockFromInstant } from "@/lib/grouping/capture-time";
import { detectDivider } from "@/lib/grouping/divider";
import { applyVerdicts, checkWindows, proposeGroups, shootingOrder, type CheckedGroup, type WindowVerdict } from "@/lib/grouping/group";
import { checkWindow, confirmColorDividers, type CheckPhoto } from "@/lib/grouping/check";
import { MAX_PHOTO_BYTES } from "@/lib/items";

// Phase 2 batch flow: create an upload, add photos one request at a time,
// group them into items (dividers, time gaps, Claude's check), let the seller
// fix the groups, then confirm. Confirmed items are drafted in the background
// by src/lib/worker.ts.

export class UploadStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadStateError";
  }
}

export async function createUpload(): Promise<string> {
  const [row] = await db().insert(schema.uploads).values({ status: "uploading" }).returning({ id: schema.uploads.id });
  return row.id;
}

async function getUpload(uploadId: string) {
  const [upload] = await db().select().from(schema.uploads).where(eq(schema.uploads.id, uploadId));
  if (!upload) throw new UploadStateError("Upload not found.");
  return upload;
}

export type AddPhotoMeta = { pickOrder: number; lastModified?: number | null; tzOffsetMinutes?: number | null };

/** Stores one photo: private original, public listing-size copy, capture time, divider check. Idempotent per file. */
export async function addPhoto(uploadId: string, file: File, meta: AddPhotoMeta) {
  const upload = await getUpload(uploadId);
  if (upload.status !== "uploading" && upload.status !== "grouped") {
    throw new UploadStateError("This batch is already being drafted. Start a new batch to add more photos.");
  }
  if (file.size > MAX_PHOTO_BYTES) throw new UploadStateError(`${file.name} is larger than 30 MB.`);

  const clientKey = `${file.name}|${file.size}|${meta.lastModified ?? ""}`.slice(0, 300);
  const [existing] = await db()
    .select()
    .from(schema.photos)
    .where(and(eq(schema.photos.uploadId, uploadId), eq(schema.photos.clientKey, clientKey)));
  if (existing) return photoSummary(existing);

  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const originalKey = `${uploadId}/${randomUUID()}.${ext}`;
  await putOriginal(originalKey, bytes, file.type || "application/octet-stream");

  const processed = await processPhoto(bytes, file.name, file.type);
  const listingKey = `p/${randomUUID()}.jpg`;
  await putPublic(listingKey, processed.listing);
  const thumbKey = `t/${randomUUID()}.jpg`;
  await putPublic(thumbKey, await makeThumb(processed.listing));
  const divider = await detectDivider(processed.listing).catch(() => null);

  const lastModified =
    meta.lastModified && Number.isFinite(meta.lastModified)
      ? wallClockFromInstant(meta.lastModified, meta.tzOffsetMinutes ?? 0)
      : null;
  const when = captureTime({ exif: processed.takenAt, fileName: file.name, lastModified });

  const [row] = await db()
    .insert(schema.photos)
    .values({
      uploadId,
      originalKey,
      listingKey,
      thumbKey,
      fileName: file.name.slice(0, 200),
      width: processed.width,
      height: processed.height,
      takenAt: when.at,
      captureSource: when.source,
      position: meta.pickOrder,
      pickOrder: meta.pickOrder,
      isDivider: divider !== null,
      dividerSource: divider,
      clientKey,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    // Two copies of the same file raced; the other one won.
    const [winner] = await db()
      .select()
      .from(schema.photos)
      .where(and(eq(schema.photos.uploadId, uploadId), eq(schema.photos.clientKey, clientKey)));
    return photoSummary(winner);
  }
  await db()
    .update(schema.uploads)
    .set({ photoCount: sql`${schema.uploads.photoCount} + 1` })
    .where(eq(schema.uploads.id, uploadId));
  return photoSummary(row);
}

function photoSummary(p: typeof schema.photos.$inferSelect) {
  const key = p.thumbKey ?? p.listingKey;
  return { id: p.id, fileName: p.fileName, isDivider: p.isDivider, thumbUrl: key ? publicUrl(key) : null };
}

type Checker = (photos: CheckPhoto[], firstContinuesItem: boolean) => Promise<WindowVerdict>;
type ColorConfirmer = (photos: { id: string; jpeg: Buffer }[]) => Promise<Set<string>>;

/** Proposes items for an upload and has Claude check the uncertain ones. Replaces any earlier grouping. */
export async function groupUpload(uploadId: string, checker: Checker = checkWindow, confirmColor: ColorConfirmer = confirmColorDividers) {
  const upload = await getUpload(uploadId);
  if (upload.status === "confirmed") throw new UploadStateError("This batch is already being drafted.");
  await db().update(schema.uploads).set({ status: "grouping", groupingError: null }).where(eq(schema.uploads.id, uploadId));

  try {
    const photos = await db()
      .select()
      .from(schema.photos)
      .where(and(eq(schema.photos.uploadId, uploadId), eq(schema.photos.excluded, false)));
    if (!photos.length) throw new UploadStateError("This batch has no photos yet.");

    // Orange-only matches are confirmed by Claude once ("color" -> "color-ok", or not a divider).
    const unconfirmed = photos.filter((p) => p.isDivider && p.dividerSource === "color");
    if (unconfirmed.length) {
      try {
        const confirmed = await confirmColor(
          await Promise.all(unconfirmed.map(async (p) => ({ id: p.id, jpeg: await getPublicBytes(p.listingKey!) }))),
        );
        for (const p of unconfirmed) {
          const ok = confirmed.has(p.id);
          p.isDivider = ok;
          p.dividerSource = ok ? "color-ok" : null;
          await db().update(schema.photos).set({ isDivider: ok, dividerSource: p.dividerSource }).where(eq(schema.photos.id, p.id));
        }
      } catch {
        // Claude unavailable: keep them as dividers; the grouping screen lists them under "Left out".
      }
    }
    // Dividers Claude found last time are re-checked: only the local detectors' dividers are fixed facts.
    const proposed = proposeGroups(
      photos.map((p) => ({
        id: p.id,
        fileName: p.fileName,
        takenAt: p.takenAt,
        sameSecond: sameSecondCounter(p.fileName),
        pickOrder: p.pickOrder,
        isDivider: p.isDivider && p.dividerSource !== "claude",
      })),
    );

    const byId = new Map(photos.map((p) => [p.id, p]));
    const windows = checkWindows(proposed);
    const groupStarts = new Set(proposed.map((g) => g.photoIds[0]));
    const verdicts: WindowVerdict[] = [];
    const problems: string[] = [];
    await inBatches(windows, 3, async (w) => {
      try {
        const checkPhotos: CheckPhoto[] = await Promise.all(
          w.photoIds.map(async (id, i) => {
            const p = byId.get(id)!;
            const prev = i > 0 ? byId.get(w.photoIds[i - 1]) : undefined;
            const minutes = prev?.takenAt && p.takenAt ? (p.takenAt.getTime() - prev.takenAt.getTime()) / 60_000 : null;
            return { id, jpeg: await getPublicBytes(p.listingKey!), minutesSincePrevious: minutes };
          }),
        );
        verdicts.push(await checker(checkPhotos, !groupStarts.has(w.photoIds[0])));
      } catch (err) {
        problems.push(err instanceof Error ? err.message : String(err));
      }
    });
    const { groups, dividers } = applyVerdicts(proposed, verdicts);
    await saveGrouping(uploadId, groups, { claudeDividers: dividers });
    await db()
      .update(schema.uploads)
      .set({
        status: "grouped",
        groupingError: problems.length ? `Claude couldn't check ${problems.length} part(s) of this batch: ${problems[0]}` : null,
      })
      .where(eq(schema.uploads.id, uploadId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db().update(schema.uploads).set({ status: "uploading", groupingError: message }).where(eq(schema.uploads.id, uploadId));
    throw err;
  }
}

async function inBatches<T>(list: T[], size: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < list.length; i += size) await Promise.all(list.slice(i, i + size).map(fn));
}

function noteFor(g: CheckedGroup): string | null {
  if (g.uncertain) return `Check this group: ${g.uncertain}.`;
  if (g.checkedByClaude) return "Grouped by Claude from the photos.";
  return null;
}

/** Rewrites the upload's items from groups. Only items that haven't been drafted are replaced. */
async function saveGrouping(
  uploadId: string,
  groups: { photoIds: string[]; note?: string | null; uncertain?: string | null; checkedByClaude?: boolean; startsBy?: string }[],
  opts: { claudeDividers?: string[]; dividers?: string[]; excluded?: string[] } = {},
) {
  await db().transaction(async (tx) => {
    await tx.update(schema.photos).set({ itemId: null }).where(eq(schema.photos.uploadId, uploadId));
    await tx.delete(schema.items).where(and(eq(schema.items.uploadId, uploadId), eq(schema.items.status, "grouped")));

    if (opts.claudeDividers?.length) {
      await tx
        .update(schema.photos)
        .set({ isDivider: true, dividerSource: "claude" })
        .where(and(eq(schema.photos.uploadId, uploadId), inArray(schema.photos.id, opts.claudeDividers)));
    }
    if (opts.dividers) {
      // The grouping screen sends the full list of dividers.
      await tx
        .update(schema.photos)
        .set({ isDivider: false, dividerSource: null })
        .where(and(eq(schema.photos.uploadId, uploadId), eq(schema.photos.isDivider, true)));
      if (opts.dividers.length) {
        await tx
          .update(schema.photos)
          .set({ isDivider: true, dividerSource: sql`coalesce(${schema.photos.dividerSource}, 'manual')` })
          .where(and(eq(schema.photos.uploadId, uploadId), inArray(schema.photos.id, opts.dividers)));
      }
    }
    if (opts.excluded) {
      await tx.update(schema.photos).set({ excluded: false }).where(eq(schema.photos.uploadId, uploadId));
      if (opts.excluded.length) {
        await tx
          .update(schema.photos)
          .set({ excluded: true })
          .where(and(eq(schema.photos.uploadId, uploadId), inArray(schema.photos.id, opts.excluded)));
      }
    }

    const base = Date.now();
    for (const [i, g] of groups.entries()) {
      if (!g.photoIds.length) continue;
      const [item] = await tx
        .insert(schema.items)
        .values({
          uploadId,
          groupNote: g.note !== undefined ? g.note : noteFor(g as CheckedGroup),
          // Keeps the batch's order when drafting and listing.
          createdAt: new Date(base + i),
        })
        .returning({ id: schema.items.id });
      for (const [position, photoId] of g.photoIds.entries()) {
        await tx
          .update(schema.photos)
          .set({ itemId: item.id, position })
          .where(and(eq(schema.photos.id, photoId), eq(schema.photos.uploadId, uploadId)));
      }
    }
  });
}

/** Everything the grouping screen shows. */
export async function loadUpload(uploadId: string) {
  const upload = await getUpload(uploadId);
  const rows = await db().select().from(schema.photos).where(eq(schema.photos.uploadId, uploadId));
  // The grouping screen shows every photo, dividers included, in shooting order.
  const photos = shootingOrder(rows.map((p) => ({ ...p, sameSecond: sameSecondCounter(p.fileName) })));
  const items = await db()
    .select()
    .from(schema.items)
    .where(eq(schema.items.uploadId, uploadId))
    .orderBy(asc(schema.items.createdAt), asc(schema.items.id));
  const photoView = photos.map((p) => ({
    id: p.id,
    fileName: p.fileName,
    url: p.listingKey ? publicUrl(p.listingKey) : null,
    thumbUrl: p.thumbKey ? publicUrl(p.thumbKey) : p.listingKey ? publicUrl(p.listingKey) : null,
    takenAt: p.takenAt?.toISOString() ?? null,
    isDivider: p.isDivider,
    dividerSource: p.dividerSource,
    excluded: p.excluded,
    itemId: p.itemId,
    position: p.position,
  }));
  const titles = new Map<string, string>();
  if (items.length) {
    const drafts = await db()
      .select({ itemId: schema.drafts.itemId, title: schema.drafts.title, version: schema.drafts.version })
      .from(schema.drafts)
      .where(inArray(schema.drafts.itemId, items.map((i) => i.id)))
      .orderBy(asc(schema.drafts.version));
    for (const d of drafts) if (d.title) titles.set(d.itemId, d.title);
  }
  const groups = items.map((it) => ({
    itemId: it.id,
    title: titles.get(it.id) ?? null,
    status: it.status,
    note: it.groupNote,
    error: it.error,
    photoIds: photoView
      .filter((p) => p.itemId === it.id)
      .sort((a, b) => a.position - b.position)
      .map((p) => p.id),
  }));
  return { upload, photos: photoView, groups };
}

export type GroupEdit = { photoIds: string[] }[];

/** Saves the groups as edited on the grouping screen; with `confirm`, hands them to background drafting. */
export async function saveGroupEdits(
  uploadId: string,
  edit: { groups: GroupEdit; dividers: string[]; excluded: string[]; confirm: boolean },
) {
  const upload = await getUpload(uploadId);
  if (upload.status !== "grouped") throw new UploadStateError("This batch can't be regrouped now.");

  const photos = await db().select({ id: schema.photos.id }).from(schema.photos).where(eq(schema.photos.uploadId, uploadId));
  const known = new Set(photos.map((p) => p.id));
  const seen = new Set<string>();
  for (const id of [...edit.groups.flatMap((g) => g.photoIds), ...edit.dividers, ...edit.excluded]) {
    if (!known.has(id)) throw new UploadStateError("A photo in these groups isn't part of this batch. Reload the page.");
    if (seen.has(id)) throw new UploadStateError("A photo appears twice. Reload the page and try again.");
    seen.add(id);
  }
  const tooMany = edit.groups.findIndex((g) => g.photoIds.length > 24);
  if (tooMany >= 0) throw new UploadStateError(`Item ${tooMany + 1} has ${edit.groups[tooMany].photoIds.length} photos; eBay allows 24. Split it.`);

  // Keep each group's note only if its photos are unchanged.
  const { groups: before } = await loadUpload(uploadId);
  const noteBySet = new Map(before.map((g) => [g.photoIds.join(","), g.note]));
  await saveGrouping(
    uploadId,
    edit.groups.map((g) => ({ photoIds: g.photoIds, note: noteBySet.get(g.photoIds.join(",")) ?? null })),
    { dividers: edit.dividers, excluded: edit.excluded },
  );
  if (edit.confirm) {
    await db().update(schema.uploads).set({ status: "confirmed", confirmedAt: new Date() }).where(eq(schema.uploads.id, uploadId));
  }
}

/** Batches still in progress, for the items page. */
export async function activeUploads() {
  const rows = await db()
    .select({
      id: schema.uploads.id,
      status: schema.uploads.status,
      createdAt: schema.uploads.createdAt,
      photoCount: schema.uploads.photoCount,
      items: sql<number>`count(${schema.items.id})::int`,
      waiting: sql<number>`count(*) filter (where ${schema.items.status} in ('grouped', 'drafting'))::int`,
      failed: sql<number>`count(*) filter (where ${schema.items.status} = 'failed')::int`,
    })
    .from(schema.uploads)
    .leftJoin(schema.items, eq(schema.items.uploadId, schema.uploads.id))
    .where(inArray(schema.uploads.status, ["uploading", "grouping", "grouped", "confirmed"]))
    .groupBy(schema.uploads.id)
    .orderBy(sql`${schema.uploads.createdAt} desc`)
    .limit(10);
  // A confirmed batch drops off once every item has a draft.
  return rows.filter((r) => r.status !== "confirmed" || r.waiting > 0);
}
