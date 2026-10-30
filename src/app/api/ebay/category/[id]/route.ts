import { NextResponse, type NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { categoryInfo } from "@/lib/ebay/taxonomy";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Item specifics and allowed conditions for one category (cached).
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const name = req.nextUrl.searchParams.get("name");
  const path = req.nextUrl.searchParams.get("path");
  const info = await categoryInfo(id, name ? { name, path: path || name } : undefined);
  return NextResponse.json({ category: info });
});
