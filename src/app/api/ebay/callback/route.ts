import { NextResponse, type NextRequest } from "next/server";
import { completeConsent } from "@/lib/ebay/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";

// eBay sends the browser here (via your RuName's "auth accepted URL") after consent.
export async function GET(req: NextRequest) {
  const back = (query: string) => NextResponse.redirect(`${env().APP_BASE_URL}/settings?${query}`);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get("ebay_oauth_state")?.value;

  if (!code) return back("ebay_error=" + encodeURIComponent("eBay didn't send an authorization code. Try Connect eBay again."));
  if (!state || !expected || state !== expected) {
    return back("ebay_error=" + encodeURIComponent("The sign-in link expired. Try Connect eBay again."));
  }
  try {
    await completeConsent(code);
  } catch (err) {
    return back("ebay_error=" + encodeURIComponent(err instanceof Error ? err.message : "eBay sign-in failed."));
  }
  const res = back("connected=1");
  res.cookies.delete("ebay_oauth_state");
  return res;
}
