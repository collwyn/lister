import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { publishItem } from "@/lib/items";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await publishItem(id);
  return NextResponse.json(result);
});
