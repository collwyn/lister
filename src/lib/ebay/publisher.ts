import { userToken } from "./auth";
import { EbayError, ebayFetch } from "./http";
import { inventoryItemBody, offerBody, validateListing, type ListingInput } from "./listing";

// Publishing sits behind one interface so the Phase 1 Seller Hub edit test can
// swap the Inventory API for the Trading API (AddFixedPriceItem) in one file.

export type PublishResult = { listingId: string; offerId?: string };

export interface ListingPublisher {
  readonly name: string;
  publish(input: ListingInput): Promise<PublishResult>;
}

export class ListingValidationError extends Error {
  constructor(public problems: string[]) {
    super(problems.join(" "));
    this.name = "ListingValidationError";
  }
}

type Fetcher = typeof ebayFetch;

/**
 * eBay Inventory API: create/replace the inventory item, create (or update) its
 * offer, then publish the offer. Safe to re-run for the same SKU after a failure.
 */
export class InventoryApiPublisher implements ListingPublisher {
  readonly name = "inventory-api";

  constructor(
    private fetcher: Fetcher = ebayFetch,
    private token: () => Promise<string> = userToken,
  ) {}

  async publish(input: ListingInput): Promise<PublishResult> {
    const problems = validateListing(input);
    if (problems.length) throw new ListingValidationError(problems);

    const token = await this.token();
    const sku = encodeURIComponent(input.sku);

    await this.fetcher(`/sell/inventory/v1/inventory_item/${sku}`, token, {
      method: "PUT",
      body: inventoryItemBody(input),
    });

    const offer = offerBody(input);
    let offerId: string;
    try {
      const created = await this.fetcher<{ offerId: string }>("/sell/inventory/v1/offer", token, {
        method: "POST",
        body: offer,
      });
      offerId = created.offerId;
    } catch (err) {
      // 25002: an offer already exists for this SKU (e.g. a retry). Update it instead.
      if (!(err instanceof EbayError && (err.hasErrorId(25002) || /already exists/i.test(err.message)))) throw err;
      const existing = await this.fetcher<{ offers?: { offerId: string }[] }>("/sell/inventory/v1/offer", token, {
        query: { sku: input.sku, marketplace_id: input.marketplaceId },
      });
      const found = existing.offers?.[0]?.offerId;
      if (!found) throw err;
      offerId = found;
      await this.fetcher(`/sell/inventory/v1/offer/${offerId}`, token, { method: "PUT", body: offer });
    }

    const published = await this.fetcher<{ listingId: string }>(`/sell/inventory/v1/offer/${offerId}/publish`, token, {
      method: "POST",
      body: {},
    });
    return { listingId: published.listingId, offerId };
  }
}

export function getPublisher(): ListingPublisher {
  return new InventoryApiPublisher();
}

/** Link to the listing on eBay; null in test mode, where nothing is sent to eBay. */
export function listingUrl(listingId: string, environment: string): string | null {
  if (environment === "mock") return null;
  return environment === "sandbox"
    ? `https://www.sandbox.ebay.com/itm/${listingId}`
    : `https://www.ebay.com/itm/${listingId}`;
}
