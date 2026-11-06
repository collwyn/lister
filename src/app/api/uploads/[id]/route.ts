import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { loadUpload } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Batch status and groups (the grouping and progress screens poll this).
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { upload, photos, groups } = await loadUpload(id);
  return NextResponse.json({ status: upload.status, groupingError: upload.groupingError, photos, groups });
});
