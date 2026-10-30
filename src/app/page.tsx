import Link from "next/link";
import { listItems } from "@/lib/items";

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

export default async function ItemsPage() {
  const items = await listItems();
  return (
    <main className="wrap">
      <div className="spread">
        <h1>Items</h1>
        <Link href="/items/new" className="btn primary">
          New item
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="panel empty">
          <h2>No items yet</h2>
          <p className="muted">Add photos of one item. Claude writes the draft; you review it and publish to eBay.</p>
          <Link href="/items/new" className="btn primary">
            Add your first item
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
