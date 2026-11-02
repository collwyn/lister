import { userToken } from "./auth";
import { EbayError, ebayFetch } from "./http";
import { tradingCall } from "./trading";
import { endFixedPriceItemXml, getItemXml, parseGetItem } from "./trading-xml";

// Ends a listing on eBay. Listings the app made can come from either API:
// - Inventory API (before the Trading switch): end it by withdrawing its offer.
//   Seller Hub can't manage these, so this is the only way to end them.
// - Trading API: EndFixedPriceItem.
// Before ending anything, it confirms the listing carries this item's SKU, so it
// can never end a listing the app didn't create for this item.

export class NotThisItemsListingError extends Error {
  constructor(listingId: string) {
    super(`eBay listing ${listingId} wasn't created by this app for this item, so the app won't end it. End it in Seller Hub if you need to.`);
    this.name = "NotThisItemsListingError";
  }
}

export type EndResult = { method: "inventory-api" | "trading-api"; alreadyEnded: boolean };

type Offer = { offerId: string; sku?: string; status?: string; listing?: { listingId?: string; listingStatus?: string } };

type Deps = { fetcher: typeof ebayFetch; call: typeof tradingCall; token: () => Promise<string> };
const defaults: Deps = { fetcher: ebayFetch, call: tradingCall, token: userToken };

export async function endEbayListing(
  target: { listingId: string; sku: string; marketplaceId: string },
  deps: Deps = defaults,
): Promise<EndResult> {
  const token = await deps.token();

  // 1. Is it an Inventory API listing for this SKU?
  let offers: Offer[] = [];
  try {
    const res = await deps.fetcher<{ offers?: Offer[] }>("/sell/inventory/v1/offer", token, {
      query: { sku: target.sku, marketplace_id: target.marketplaceId },
    });
    offers = res.offers ?? [];
  } catch (err) {
    // No inventory item/offer for this SKU: it isn't an Inventory API listing.
    if (!(err instanceof EbayError)) throw err;
  }
  const offer = offers.find((o) => o.listing?.listingId === target.listingId);
  if (offer) {
    if (offer.status !== "PUBLISHED") return { method: "inventory-api", alreadyEnded: true };
    await deps.fetcher(`/sell/inventory/v1/offer/${encodeURIComponent(offer.offerId)}/withdraw`, token, { method: "POST", body: {} });
    return { method: "inventory-api", alreadyEnded: false };
  }

  // 2. Otherwise a Trading API listing: check it's this item's, then end it.
  let item: { sku?: string; listingStatus?: string };
  try {
    item = parseGetItem((await deps.call("GetItem", getItemXml(target.listingId), token)).raw ?? "");
  } catch (err) {
    if (err instanceof EbayError) throw new NotThisItemsListingError(target.listingId);
    throw err;
  }
  if (item.sku !== target.sku) throw new NotThisItemsListingError(target.listingId);
  if (item.listingStatus && item.listingStatus !== "Active") return { method: "trading-api", alreadyEnded: true };

  await deps.call("EndFixedPriceItem", endFixedPriceItemXml(target.listingId), token);
  return { method: "trading-api", alreadyEnded: false };
}
