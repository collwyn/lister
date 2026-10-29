import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import "./globals.css";
import { SESSION_COOKIE } from "@/lib/session";
import { SignOutButton } from "@/components/SignOutButton";

export const metadata: Metadata = { title: "Listing Desk", description: "Photos in, eBay listings out." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const signedIn = (await cookies()).has(SESSION_COOKIE);
  const environment = process.env.EBAY_ENV === "production" ? "production" : "sandbox";
  return (
    <html lang="en">
      <body>
        {signedIn && (
          <header className="topbar">
            <div className="wrap inner">
              <Link href="/" className="brand">
                Listing Desk
              </Link>
              <nav className="nav">
                <Link href="/">Items</Link>
                <Link href="/items/new">New item</Link>
                <Link href="/settings">Settings</Link>
              </nav>
              <span className={`env ${environment}`} title="eBay environment">
                eBay {environment}
              </span>
              <SignOutButton />
            </div>
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
