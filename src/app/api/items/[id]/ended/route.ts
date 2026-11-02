import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { markListingEnded } from "@/lib/items";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// The item's eBay listing has ended: forget it so the item can be listed again.
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await markListingEnded(id);
  return NextResponse.json({ ok: true });
});
