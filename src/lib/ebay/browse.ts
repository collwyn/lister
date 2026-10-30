import type { Comp } from "@/db/schema";
import { appToken } from "./auth";
import { ebayFetch } from "./http";

// Comparable ACTIVE fixed-price listings. eBay's sold-data API is restricted,
// so these run higher than real sale prices; pricing accounts for that.

type SearchResponse = {
  itemSummaries?: {
    title: string;
    price?: { value: string; currency: string };
    condition?: string;
    itemWebUrl?: string;
  }[];
};

export async function findComps(query: string, categoryId?: string, limit = 20): Promise<Comp[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const res = await ebayFetch<SearchResponse>("/buy/browse/v1/item_summary/search", await appToken(), {
    query: {
      q,
      category_ids: categoryId,
      filter: "buyingOptions:{FIXED_PRICE}",
      limit: String(limit),
    },
  });
  return (res.itemSummaries ?? [])
    .filter((s) => s.price && Number(s.price.value) > 0)
    .map((s) => ({
      title: s.title,
      price: Number(s.price!.value),
      currency: s.price!.currency,
      condition: s.condition,
      url: s.itemWebUrl,
    }));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
