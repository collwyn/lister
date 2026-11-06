import { and, eq, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { draftItem } from "@/lib/drafting/draft";

// Background drafting. Runs inside the web app (started from src/instrumentation.ts),
// so Sevalla needs no second process. Items of confirmed batches move
// grouped -> drafting -> needs_review (or failed). Claiming uses
// FOR UPDATE SKIP LOCKED, so two app instances never draft the same item.

const POLL_MS = 10_000;
const STALE_MS = 15 * 60_000;
export const MAX_ATTEMPTS = 3;

let started = false;
let running = 0;

/** Takes the next waiting item, or null. */
export async function claimNext(): Promise<string | null> {
  const rows = await db().execute<{ id: string }>(sql`
    update items set status = 'drafting', draft_attempts = draft_attempts + 1, updated_at = now()
    where id = (
      select i.id from items i join uploads u on u.id = i.upload_id
      where i.status = 'grouped' and u.status = 'confirmed'
      order by i.created_at, i.id
      limit 1
      for update of i skip locked
    )
    returning id`);
  return rows[0]?.id ?? null;
}

/** Items left "drafting" by a restart go back in the queue, or fail after MAX_ATTEMPTS. */
export async function recoverStale(now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_MS);
  const stale = await db()
    .select({ id: schema.items.id, attempts: schema.items.draftAttempts })
    .from(schema.items)
    .innerJoin(schema.uploads, eq(schema.uploads.id, schema.items.uploadId))
    .where(and(eq(schema.items.status, "drafting"), eq(schema.uploads.status, "confirmed"), lt(schema.items.updatedAt, cutoff)));
  for (const it of stale) {
    await db()
      .update(schema.items)
      .set(
        it.attempts >= MAX_ATTEMPTS
          ? { status: "failed", error: "Drafting didn't finish after several tries. Open the item and press Write draft." }
          : { status: "grouped" },
      )
      .where(and(eq(schema.items.id, it.id), eq(schema.items.status, "drafting")));
  }
}

async function tick() {
  const limit = env().DRAFT_CONCURRENCY;
  await recoverStale();
  while (running < limit) {
    const id = await claimNext();
    if (!id) return;
    running++;
    // draftItem records failures on the item itself.
    draftItem(id)
      .catch(() => undefined)
      .finally(() => {
        running--;
        // Pick up the next item straight away rather than waiting for the timer.
        void tick().catch(logOnce);
      });
  }
}

let lastLogged = "";
function logOnce(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (message !== lastLogged) console.error("Background drafting:", message);
  lastLogged = message;
}

export function startWorker() {
  if (started) return;
  started = true;
  let limit = 0;
  try {
    limit = env().DRAFT_CONCURRENCY;
  } catch (err) {
    logOnce(err); // settings incomplete: the app shows the problem elsewhere
    return;
  }
  if (limit === 0) return;
  const loop = () => void tick().catch(logOnce);
  setInterval(loop, POLL_MS).unref?.();
  setTimeout(loop, 3_000).unref?.();
}
