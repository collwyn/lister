import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Divider card · Listing Desk" };

export default function DividerCardPage() {
  return (
    <main className="wrap">
      <div className="panel noprint">
        <h1>Divider card</h1>
        <p>
          Print this card and photograph it once between items: item, item, item, <strong>card</strong>, next item. The app reads the QR code and
          starts a new item after it. The card itself is never used as a listing photo.
        </p>
        <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Print in color on plain paper (letter size; the card is half a page). Card stock lasts longer.</li>
          <li>The QR code just needs to be in the shot; angle and distance don&apos;t matter much.</li>
          <li>No printer? A plain bright-orange sheet filling most of the frame works too, or show this page on another screen.</li>
          <li>Forgot the card for an item? Fine: Claude checks the groups, and you can fix them before drafting.</li>
        </ul>
        <div className="row">
          <PrintButton />
          <a className="btn" href="/divider-card.svg" download="listing-desk-divider-card.svg">
            Download the card
          </a>
        </div>
      </div>
      <div className="dividercard">
        <img src="/divider-card.svg" alt="Divider card: NEXT ITEM, with a QR code" />
      </div>
    </main>
  );
}
