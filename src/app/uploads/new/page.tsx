import Link from "next/link";
import { BatchUploader } from "@/components/BatchUploader";

export default function NewBatchPage() {
  return (
    <main className="wrap">
      <div className="spread">
        <h1>Add photos</h1>
        <Link href="/items/new" className="small">
          Just one item? Use the single-item upload
        </Link>
      </div>
      <div className="panel">
        <p>
          Photograph items one after another, and take one photo of the <strong>divider card</strong> between items. Upload the whole set here; the
          app sorts the photos into items, then Claude drafts each one.
        </p>
        <p className="muted small">
          No divider card? It still works: the app groups by pauses between photos and Claude checks the groups by looking at them. You confirm
          the groups before anything is drafted. <Link href="/divider-card">Print a divider card</Link>.
        </p>
      </div>
      <BatchUploader />
    </main>
  );
}
