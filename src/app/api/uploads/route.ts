import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { createUpload } from "@/lib/uploads";

export const runtime = "nodejs";

// Starts a batch. Photos are then added one per request (./[id]/photos).
export const POST = handle(async () => NextResponse.json({ id: await createUpload() }));
