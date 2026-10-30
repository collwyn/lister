import { describe, expect, it, vi } from "vitest";

// The publisher module imports auth (and through it env/db); stub those so the
// test exercises only the request sequence.
vi.mock("@/lib/ebay/auth", () => ({ userToken: async () => "user-token" }));

import { EbayError } from "@/lib/ebay/http";
import { InventoryApiPublisher, ListingValidationError } from "@/lib/ebay/publisher";
import type { ListingInput } from "@/lib/ebay/listing";

const input: ListingInput = {
  sku: "abc-1",
  title: "Vintage Brass Table Lamp",
  description: "A brass lamp.",
  categoryId: "112581",
  conditionId: "3000",
  aspects: { Brand: ["Unbranded"] },
  price: 45,
  quantity: 1,
  imageUrls: ["https://photos.example/p/1.jpg"],
  marketplaceId: "EBAY_US",
  policies: { paymentPolicyId: "p", returnPolicyId: "r", fulfillmentPolicyId: "f" },
  merchantLocationKey: "home",
};

type Call = { path: string; method: string; body?: unknown; query?: Record<string, string | undefined> };

function fakeFetcher(handler: (c: Call) => unknown) {
  const calls: Call[] = [];
  const fetcher = (async (path: string, _token: string, init: any = {}) => {
    const call = { path, method: init.method ?? "GET", body: init.body, query: init.query };
    calls.push(call);
    return handler(call);
  }) as any;
  return { calls, fetcher };
}

describe("InventoryApiPublisher", () => {
  it("creates the inventory item, the offer, then publishes", async () => {
    const { calls, fetcher } = fakeFetcher((c) => {
      if (c.path === "/sell/inventory/v1/offer" && c.method === "POST") return { offerId: "O1" };
      if (c.path.endsWith("/publish")) return { listingId: "L1" };
      return null;
    });
    const result = await new InventoryApiPublisher(fetcher, async () => "t").publish(input);
    expect(result).toEqual({ listingId: "L1", offerId: "O1" });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "PUT /sell/inventory/v1/inventory_item/abc-1",
      "POST /sell/inventory/v1/offer",
      "POST /sell/inventory/v1/offer/O1/publish",
    ]);
  });

  it("reuses and updates an existing offer when eBay says one already exists", async () => {
    const { calls, fetcher } = fakeFetcher((c) => {
      if (c.path === "/sell/inventory/v1/offer" && c.method === "POST") {
        throw new EbayError(400, [{ errorId: 25002, message: "Offer entity already exists." }], "x");
      }
      if (c.path === "/sell/inventory/v1/offer" && c.method === "GET") return { offers: [{ offerId: "O9" }] };
      if (c.path.endsWith("/publish")) return { listingId: "L9" };
      return null;
    });
    const result = await new InventoryApiPublisher(fetcher, async () => "t").publish(input);
    expect(result.listingId).toBe("L9");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "PUT /sell/inventory/v1/inventory_item/abc-1",
      "POST /sell/inventory/v1/offer",
      "GET /sell/inventory/v1/offer",
      "PUT /sell/inventory/v1/offer/O9",
      "POST /sell/inventory/v1/offer/O9/publish",
    ]);
  });

  it("passes other eBay errors through with eBay's message", async () => {
    const { fetcher } = fakeFetcher((c) => {
      if (c.path.endsWith("/publish")) {
        throw new EbayError(400, [{ errorId: 25021, longMessage: "Item specific Brand is missing." }], "x");
      }
      if (c.method === "POST") return { offerId: "O1" };
      return null;
    });
    await expect(new InventoryApiPublisher(fetcher, async () => "t").publish(input)).rejects.toThrow(
      "Item specific Brand is missing.",
    );
  });

  it("refuses an incomplete listing before calling eBay", async () => {
    const { calls, fetcher } = fakeFetcher(() => null);
    await expect(
      new InventoryApiPublisher(fetcher, async () => "t").publish({ ...input, imageUrls: [] }),
    ).rejects.toBeInstanceOf(ListingValidationError);
    expect(calls).toHaveLength(0);
  });
});
