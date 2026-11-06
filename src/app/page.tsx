import Link from "next/link";
import { listItems } from "@/lib/items";
import { activeUploads } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  grouped: "No draft yet",
  drafting: "Drafting",
  needs_review: "Needs review",
  approved: "Approved",
  listed: "Listed",
  sold: "Sold",
  held: "Held",
  rejected: "Not selling",
  failed: "Draft failed",
};

const BATCH_STATUS: Record<string, string> = {
  uploading: "Uploading: add more photos or sort into items",
  grouping: "Sorting into items…",
  grouped: "Check the groups, then start drafting",
  confirmed: "Drafting in the background",
};

export default async function ItemsPage() {
  const [items, batches] = await Promise.all([listItems(), activeUploads()]);
  return (
    <main className="wrap">
      <div className="spread">
        <h1>Items</h1>
        <Link href="/uploads/new" className="btn primary">
          Add photos
        </Link>
      </div>
      {batches.length > 0 && (
        <div className="items">
          {batches.map((b) => (
            <Link key={b.id} href={`/uploads/${b.id}`} className="itemrow batchrow">
              <span className="thumb" />
              <div style={{ minWidth: 0 }}>
                <div className="title">Batch of {b.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                <div className="muted small">
                  {BATCH_STATUS[b.status] ?? b.status}
                  {b.status === "confirmed" && ` · ${b.items - b.waiting} of ${b.items} drafted`}
                  {b.failed > 0 && ` · ${b.failed} failed`}
                </div>
              </div>
              <span className="pill">{b.photoCount} photos</span>
            </Link>
          ))}
        </div>
      )}
      {items.length === 0 && batches.length === 0 ? (
        <div className="panel empty">
          <h2>No items yet</h2>
          <p className="muted">Upload photos of your items. Claude sorts and drafts them; you review each one and publish to eBay.</p>
          <Link href="/uploads/new" className="btn primary">
            Add photos
          </Link>
        </div>
      ) : (
        <div className="items">
          {items.map((it) => (
            <Link key={it.id} href={`/items/${it.id}`} className="itemrow">
              {it.thumbUrl ? <img className="thumb" src={it.thumbUrl} alt="" /> : <span className="thumb" />}
              <div style={{ minWidth: 0 }}>
                <div className="title">{it.draft?.title || "Untitled item"}</div>
                <div className="muted small">
                  {it.draft?.categoryName?.split(" > ").slice(-2).join(" › ") || "No category yet"}
                  {it.flags.length > 0 && ` · ${it.flags.length} to check`}
                </div>
              </div>
              <div style={{ textAlign: "right", display: "grid", gap: 4, justifyItems: "end" }}>
                <span className={`pill ${it.status}`}>{STATUS_LABEL[it.status] ?? it.status}</span>
                {it.draft?.price && <span className="mono small">${Number(it.draft.price).toFixed(2)}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
