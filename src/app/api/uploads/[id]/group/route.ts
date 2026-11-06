import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { groupUpload } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

// Splits the batch into items: divider cards, pauses between photos, Claude's check.
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await groupUpload(id);
  return NextResponse.json({ ok: true });
});
