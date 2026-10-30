import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@/lib/db";
import { deletionChallengeResponse } from "@/lib/crypto";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// eBay Marketplace Account Deletion endpoint. eBay keeps production keys
// disabled until this answers its challenge. Register this exact URL:
//   ${APP_BASE_URL}/api/ebay/account-deletion
// Listing Desk stores only your own listings, never other eBay users' data,
// so notifications are acknowledged and logged.

function endpointUrl() {
  return `${env().APP_BASE_URL}/api/ebay/account-deletion`;
}

export async function GET(req: NextRequest) {
  const challengeCode = req.nextUrl.searchParams.get("challenge_code");
  if (!challengeCode) return NextResponse.json({ error: "Missing challenge_code" }, { status: 400 });
  const token = env().EBAY_VERIFICATION_TOKEN;
  if (!token) return NextResponse.json({ error: "EBAY_VERIFICATION_TOKEN is not set." }, { status: 503 });
  const challengeResponse = deletionChallengeResponse(challengeCode, token, endpointUrl());
  return NextResponse.json({ challengeResponse });
}

export async function POST(req: NextRequest) {
  const text = await req.text();
  if (text.length > 20_000) return new NextResponse(null, { status: 413 });
  try {
    await db().insert(schema.accountDeletionEvents).values({ payload: JSON.parse(text || "{}") });
  } catch (err) {
    console.error("Could not log account deletion notification", err);
  }
  // eBay expects a 2xx acknowledgement.
  return new NextResponse(null, { status: 204 });
}
