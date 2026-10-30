import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { consentUrl } from "@/lib/ebay/auth";

export const runtime = "nodejs";

// Starts eBay's consent screen. The random state is checked on return (CSRF guard).
export const GET = handle(async () => {
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
