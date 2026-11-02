import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { endListingOnEbay } from "@/lib/items";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ listingId: z.string().regex(/^[A-Za-z0-9-]{1,40}$/, "Invalid listing number.").optional() });

// Ends this item's listing on eBay (or the older one eBay said blocks a relist).
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { listingId } = body.parse(await req.json().catch(() => ({})));
  return NextResponse.json(await endListingOnEbay(id, listingId));
});
