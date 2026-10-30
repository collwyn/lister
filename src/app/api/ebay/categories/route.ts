import { NextResponse, type NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { suggestCategories } from "@/lib/ebay/taxonomy";

export const runtime = "nodejs";

// Category search for the review screen: any words in, eBay's best-matching categories out.
export const GET = handle(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ suggestions: await suggestCategories(q) });
});
