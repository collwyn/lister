import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { checkStorage } from "@/lib/storage";

export const runtime = "nodejs";

// Settings → "Check photo storage": tests both buckets without uploading an item.
export const POST = handle(async () => NextResponse.json({ results: await checkStorage() }));
