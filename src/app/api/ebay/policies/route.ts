import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { listPolicies } from "@/lib/ebay/account";

export const runtime = "nodejs";

export const GET = handle(async () => NextResponse.json(await listPolicies()));
