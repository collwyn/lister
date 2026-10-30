import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { createStarterPolicies } from "@/lib/ebay/account";

export const runtime = "nodejs";

export const POST = handle(async () => {
  await createStarterPolicies();
  return NextResponse.json({ ok: true });
});
