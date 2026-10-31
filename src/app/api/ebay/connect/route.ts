import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { connectMock, consentUrl } from "@/lib/ebay/auth";
import { env, isMockEbay } from "@/lib/env";

export const runtime = "nodejs";

// Starts eBay's consent screen. The random state is checked on return (CSRF guard).
export const GET = handle(async () => {
  if (isMockEbay()) {
    await connectMock();
    return NextResponse.redirect(`${env().APP_BASE_URL}/settings?connected=1`);
  }
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(consentUrl(state));
  res.cookies.set("ebay_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
});
