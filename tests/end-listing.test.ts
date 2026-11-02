import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { duplicateListingId, endFixedPriceItemXml, getItemXml, parseGetItem } from "@/lib/ebay/trading-xml";
import type { ListingInput } from "@/lib/ebay/listing";

describe("eBay's duplicate-listing message", () => {
  it("gives the item number of the listing that's already up", () => {
    const msg =
      "eBay: It looks like this listing is for an item you already have on eBay: Epiphone Les Paul Special Model Electric Guitar Wine Red Satin P-90 Pickups (110591498168). We don't allow listings for identical items from the same seller to appear on eBay at the same time.";
    expect(duplicateListingId(msg)).toBe("110591498168");
  });

  it("ignores other errors, even ones with numbers in brackets", () => {
    expect(duplicateListingId("eBay: The item specific Brand is missing (21919303).")).toBeNull();
    expect(duplicateListingId(null)).toBeNull();
  });
});

describe("ending requests", () => {
  it("asks GetItem only for the SKU and status", () => {
    const x = getItemXml("110591498168");
    expect(x).toContain("<GetItemRequest ");
    expect(x).toContain("<ItemID>110591498168</ItemID>");
    expect(x).toContain("<OutputSelector>Item.SKU</OutputSelector>");
  });

  it("reads the SKU and status back", () => {
    expect(parseGetItem("<R><Item><ItemID>1</ItemID><SKU>abc</SKU><SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus></Item></R>")).toEqual({
      sku: "abc",
      listingStatus: "Active",
    });
  });

  it("ends a fixed-price listing as no longer available", () => {
    const x = endFixedPriceItemXml("110591498168");
    expect(x).toContain("<EndFixedPriceItemRequest ");
    expect(x).toContain("<ItemID>110591498168</ItemID><EndingReason>NotAvailable</EndingReason>");
  });
});

describe("ending listings (test mode)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/ebay/auth", () => ({ userToken: async () => "user-token" }));
    Object.assign(process.env, {
      APP_BASE_URL: "https://lister.example",
      ADMIN_PASSWORD_HASH: "$2b$12$" + "x".repeat(53),
      SESSION_SECRET: "s".repeat(44),
      ENCRYPTION_KEY: "k".repeat(44),
      DATABASE_URL: "postgres://x",
      S3_ENDPOINT: "https://s3.example",
      S3_ACCESS_KEY_ID: "a",
      S3_SECRET_ACCESS_KEY: "b",
      S3_BUCKET_ORIGINALS: "o",
      S3_BUCKET_PUBLIC: "p",
      PUBLIC_PHOTO_BASE_URL: "https://p.example",
      ANTHROPIC_API_KEY: "x",
      EBAY_ENV: "mock",
    });
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const listing = (sku: string): ListingInput => ({
    sku,
    title: "Sony WH-1000XM4 Wireless Headphones",
    description: "Works well.",
    categoryId: "mock-headphones",
    conditionId: "3000",
    aspects: { Brand: ["Sony"], Type: ["Ear-Cup (Over the Ear)"] },
    price: 120,
    quantity: 1,
    imageUrls: ["https://p.example/p/1.jpg"],
    marketplaceId: "EBAY_US",
    policies: { paymentPolicyId: "mock-pay", returnPolicyId: "mock-ret", fulfillmentPolicyId: "mock-ship-small" },
    merchantLocationKey: "home",
    shipFrom: { postalCode: "11201" },
  });
  const sku = () => `sku-${Math.random().toString(36).slice(2)}`;

  it("ends a Trading API listing, and knows when it has already ended", async () => {
    const { TradingApiPublisher } = await import("@/lib/ebay/publisher");
    const { endEbayListing } = await import("@/lib/ebay/end-listing");
    const s = sku();
    const { listingId } = await new TradingApiPublisher().publish(listing(s));
    const target = { listingId, sku: s, marketplaceId: "EBAY_US" };
    expect(await endEbayListing(target)).toEqual({ method: "trading-api", alreadyEnded: false });
    expect(await endEbayListing(target)).toEqual({ method: "trading-api", alreadyEnded: true });
  });

  it("ends an older Inventory API listing by withdrawing its offer", async () => {
    const { InventoryApiPublisher } = await import("@/lib/ebay/publisher");
    const { endEbayListing } = await import("@/lib/ebay/end-listing");
    const s = sku();
    const { listingId } = await new InventoryApiPublisher().publish(listing(s));
    const target = { listingId, sku: s, marketplaceId: "EBAY_US" };
    expect(await endEbayListing(target)).toEqual({ method: "inventory-api", alreadyEnded: false });
    expect(await endEbayListing(target)).toEqual({ method: "inventory-api", alreadyEnded: true });
  });

  it("refuses to end a listing that belongs to a different item", async () => {
    const { TradingApiPublisher } = await import("@/lib/ebay/publisher");
    const { endEbayListing, NotThisItemsListingError } = await import("@/lib/ebay/end-listing");
    const { listingId } = await new TradingApiPublisher().publish(listing(sku()));
    await expect(endEbayListing({ listingId, sku: "another-item", marketplaceId: "EBAY_US" })).rejects.toBeInstanceOf(NotThisItemsListingError);
    await expect(endEbayListing({ listingId: "119999999999", sku: "another-item", marketplaceId: "EBAY_US" })).rejects.toBeInstanceOf(
      NotThisItemsListingError,
    );
  });
});
