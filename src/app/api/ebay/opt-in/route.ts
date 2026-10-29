import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { optInToBusinessPolicies } from "@/lib/ebay/account";

export const runtime = "nodejs";

export const POST = handle(async () => NextResponse.json({ result: await optInToBusinessPolicies() }));
