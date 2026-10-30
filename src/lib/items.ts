import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { processPhoto } from "@/lib/images";
import { publicUrl, putOriginal, putPublic } from "@/lib/storage";
import { getAccount } from "@/lib/ebay/auth";
import { getPublisher, listingUrl } from "@/lib/ebay/publisher";
import type { ListingInput } from "@/lib/ebay/listing";
import type { Draft } from "@/db/schema";

export const MAX_PHOTOS_PER_ITEM = 24;
export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

/** Phase 1: one upload = one item. Stores originals privately and resized copies publicly. */
export async function createItemWithPhotos(files: File[]): Promise<string> {
  const usable = files.filter((f) => f.size > 0).slice(0, MAX_PHOTOS_PER_ITEM);
  if (!usable.length) throw new Error("Choose at least one photo.");
  const tooBig = usable.find((f) => f.size > MAX_PHOTO_BYTES);
  if (tooBig) throw new Error(`${tooBig.name} is larger than 30 MB.`);

  const [upload] = await db().insert(schema.uploads).values({ photoCount: usable.length }).returning();
  const [item] = await db().insert(schema.items).values({ uploadId: upload.id }).returning();

  let position = 0;
  for (const file of usable) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const originalKey = `${upload.id}/${randomUUID()}.${ext}`;
    await putOriginal(originalKey, bytes, file.type || "application/octet-stream");

    const processed = await processPhoto(bytes, file.name, file.type);
    // Random, unguessable names: the public bucket must not reveal anything else.
    const listingKey = `p/${randomUUID()}.jpg`;
    await putPublic(listingKey, processed.listing);

    await db()
      .insert(schema.photos)
      .values({
        uploadId: upload.id,
        itemId: item.id,
        originalKey,
        listingKey,
        fileName: file.name.slice(0, 200),
        width: processed.width,
        height: processed.height,
        takenAt: processed.takenAt,
        position: position++,
      });
  }
  return item.id;
}

export async function loadItem(id: string) {
  const [item] = await db().select().from(schema.items).where(eq(schema.items.id, id));
  if (!item) return null;
  const photos = await db()
    .select()
    .from(schema.photos)
    .where(eq(schema.photos.itemId, id))
    .orderBy(asc(schema.photos.position));
  const [draft] = await db()
    .select()
    .from(schema.drafts)
    .where(eq(schema.drafts.itemId, id))
    .orderBy(desc(schema.drafts.version))
    .limit(1);
  const [listing] = await db()
    .select()
    .from(schema.listings)
    .where(and(eq(schema.listings.itemId, id), eq(schema.listings.environment, env().EBAY_ENV)))
    .limit(1);
  return {
    item,
    photos: photos.map((p) => ({ ...p, url: p.listingKey ? publicUrl(p.listingKey) : null })),
    draft: draft ?? null,
    listing: listing ? { ...listing, url: listing.ebayListingId ? listingUrl(listing.ebayListingId, listing.environment) : null } : null,
  };
}

export async function listItems() {
  const rows = await db().select().from(schema.items).orderBy(desc(schema.items.createdAt)).limit(200);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const drafts = await db()
    .select()
    .from(schema.drafts)
    .where(inArray(schema.drafts.itemId, ids))
    .orderBy(desc(schema.drafts.version));
  const firstPhotos = await db()
    .select()
    .from(schema.photos)
    .where(and(inArray(schema.photos.itemId, ids), eq(schema.photos.position, 0)));
  const latest = new Map<string, Draft>();
  for (const d of drafts) if (!latest.has(d.itemId)) latest.set(d.itemId, d);
  const thumb = new Map(firstPhotos.map((p) => [p.itemId, p.listingKey ? publicUrl(p.listingKey) : null]));
  return rows.map((r) => ({ ...r, draft: latest.get(r.id) ?? null, thumbUrl: thumb.get(r.id) ?? null }));
}

export const draftEditSchema = z.object({
  title: z.string().max(80, "Titles can be at most 80 characters."),
  description: z.string().max(20000),
  categoryId: z.string().min(1).nullable(),
  categoryName: z.string().nullable(),
  conditionId: z.string().nullable(),
  conditionNotes: z.string().max(1000).nullable(),
  aspects: z.record(z.array(z.string())),
  price: z.number().nonnegative().nullable(),
  quantity: z.number().int().min(1).max(999),
  shippingPolicyId: z.string().nullable(),
  weightOz: z.number().positive().nullable(),
});
export type DraftEdit = z.infer<typeof draftEditSchema>;

/** Saves your edits as a new draft version, keeping Claude's original for reference. */
export async function saveDraftEdits(itemId: string, edit: DraftEdit) {
  const [latest] = await db()
    .select()
    .from(schema.drafts)
    .where(eq(schema.drafts.itemId, itemId))
    .orderBy(desc(schema.drafts.version))
    .limit(1);
  const [row] = await db()
    .insert(schema.drafts)
    .values({
      itemId,
      version: (latest?.version ?? 0) + 1,
      source: "edit",
      categoryId: edit.categoryId,
      categoryName: edit.categoryName,
      title: edit.title.trim(),
      description: edit.description,
      conditionId: edit.conditionId,
      conditionNotes: edit.conditionNotes,
      aspects: edit.aspects,
      price: edit.price === null ? null : edit.price.toFixed(2),
      priceConfidence: latest?.priceConfidence ?? null,
      comps: latest?.comps ?? [],
      shippingPolicyId: edit.shippingPolicyId,
      weightOz: edit.weightOz === null ? null : edit.weightOz.toFixed(2),
      dims: latest?.dims ?? null,
      quantity: edit.quantity,
      aiNotes: latest?.aiNotes ?? null,
    })
    .returning();
  return row;
}

/** Publishes the item's latest draft to eBay and records the result. */
export async function publishItem(itemId: string) {
  const loaded = await loadItem(itemId);
  if (!loaded) throw new Error("Item not found.");
  const { item, photos, draft } = loaded;
  if (!draft) throw new Error("Write a draft first.");
  if (item.status === "listed") throw new Error("This item is already listed.");

  const account = await getAccount();
  const e = env();
  const sku = item.id;
  const input: ListingInput = {
    sku,
    title: draft.title,
    description: draft.description,
    categoryId: draft.categoryId ?? "",
    conditionId: draft.conditionId ?? "",
    conditionNotes: draft.conditionNotes,
    aspects: draft.aspects,
    price: draft.price ? Number(draft.price) : 0,
    quantity: draft.quantity,
    imageUrls: photos.filter((p) => !p.isDivider && p.url).map((p) => p.url!),
    weightOz: draft.weightOz ? Number(draft.weightOz) : null,
    dims: draft.dims,
    marketplaceId: e.EBAY_MARKETPLACE_ID,
    policies: {
      paymentPolicyId: account?.paymentPolicyId ?? "",
      returnPolicyId: account?.returnPolicyId ?? "",
      fulfillmentPolicyId: draft.shippingPolicyId ?? account?.defaultShippingPolicyId ?? "",
    },
    merchantLocationKey: account?.locationKey ?? "",
  };

  const base = { itemId, sku, environment: e.EBAY_ENV, listPrice: input.price.toFixed(2) };
  try {
    const result = await getPublisher().publish(input);
    const values = { ...base, offerId: result.offerId ?? null, ebayListingId: result.listingId, listedAt: new Date(), error: null };
    await db().insert(schema.listings).values(values).onConflictDoUpdate({ target: schema.listings.sku, set: values });
    await db().update(schema.items).set({ status: "listed", error: null }).where(eq(schema.items.id, itemId));
    return { listingId: result.listingId, url: listingUrl(result.listingId, e.EBAY_ENV) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const values = { ...base, error: message };
    await db().insert(schema.listings).values(values).onConflictDoUpdate({ target: schema.listings.sku, set: values });
    await db().update(schema.items).set({ error: message }).where(eq(schema.items.id, itemId));
    throw err;
  }
}
