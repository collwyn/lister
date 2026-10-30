import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ebay/auth", () => ({ userToken: async () => "user-token" }));

import { MOCK_CATEGORIES, mockEbay, mockSuggestions } from "@/lib/ebay/mock";
import { InventoryApiPublisher } from "@/lib/ebay/publisher";
import { EbayError } from "@/lib/ebay/errors";
import { trimAspects } from "@/lib/ebay/taxonomy";
import type { ListingInput } from "@/lib/ebay/listing";

const fetcher = ((path: string, _token: string, init?: any) => mockEbay(path, init)) as any;
const publisher = () => new InventoryApiPublisher(fetcher, async () => "t");

const listing = (over: Partial<ListingInput> = {}): ListingInput => ({
  sku: `sku-${Math.random().toString(36).slice(2)}`,
  title: "Sony WH-1000XM4 Wireless Headphones",
  description: "Used, works.",
  categoryId: "mock-headphones",
  conditionId: "3000",
  aspects: { Brand: ["Sony"], Type: ["Ear-Cup (Over the Ear)"] },
  price: 120,
  quantity: 1,
  imageUrls: ["https://photos.example/p/1.jpg"],
  marketplaceId: "EBAY_US",
  policies: { paymentPolicyId: "mock-pay", returnPolicyId: "mock-ret", fulfillmentPolicyId: "mock-ship-small" },
  merchantLocationKey: "home",
  ...over,
});

describe("test-mode categories", () => {
  it("are clearly marked as test data", () => {
    expect(MOCK_CATEGORIES.every((c) => c.id.startsWith("mock-"))).toBe(true);
  });

  it("match items by keywords, with a catch-all last", () => {
    expect(mockSuggestions("sony wh-1000xm4 wireless headphones")[0].id).toBe("mock-headphones");
    expect(mockSuggestions("amazing spider-man 300 marvel comic")[0].id).toBe("mock-comics");
    expect(mockSuggestions("vintage brass table lamp")[0].id).toBe("mock-lamps");
    expect(mockSuggestions("zzzz qqqq").map((c) => c.id)).toEqual(["mock-other"]);
  });

  it("answer the Taxonomy and Metadata calls the drafting pipeline makes", async () => {
    const s = await mockEbay<any>("/commerce/taxonomy/v1/category_tree/0/get_category_suggestions", { query: { q: "marvel comic book" } });
    expect(s.categorySuggestions[0].category.categoryId).toBe("mock-comics");
    // suggestCategories() rebuilds the full path from the ancestors, top level first
    const ancestors = [...s.categorySuggestions[0].categoryTreeNodeAncestors]
      .sort((a: any, b: any) => a.categoryTreeNodeLevel - b.categoryTreeNodeLevel)
      .map((a: any) => a.categoryName);
    expect([...ancestors, s.categorySuggestions[0].category.categoryName].join(" > ")).toBe(MOCK_CATEGORIES[0].path);
    const aspects = trimAspects(
      await mockEbay<any>("/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category", { query: { category_id: "mock-comics" } }),
    );
    expect(aspects.find((a) => a.name === "Publisher")?.required).toBe(true);
    const cond = await mockEbay<any>("/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies", {
      query: { filter: "categoryIds:{mock-books}" },
    });
    expect(cond.itemConditionPolicies[0].itemConditions.map((c: any) => c.conditionId)).toContain("4000");
  });
});

describe("test-mode publishing", () => {
  it("publishes a complete listing", async () => {
    const res = await publisher().publish(listing());
    expect(res.listingId).toMatch(/^MOCK-\d+$/);
  });

  it("rejects missing required item specifics the way eBay does", async () => {
    await expect(publisher().publish(listing({ aspects: { Brand: ["Sony"] } }))).rejects.toThrow(
      /Item specifics Type are required/,
    );
  });

  it("rejects a condition the category doesn't allow", async () => {
    await expect(publisher().publish(listing({ categoryId: "mock-books", aspects: { "Book Title": ["X"], Author: ["Y"], Language: ["English"] }, conditionId: "7000" }))).rejects.toBeInstanceOf(EbayError);
  });

  it("recovers when an offer already exists (a retry after a failure)", async () => {
    const sku = "retry-sku";
    await expect(publisher().publish(listing({ sku, aspects: {} }))).rejects.toThrow();
    const res = await publisher().publish(listing({ sku }));
    expect(res.offerId).toMatch(/^mock-offer-/);
  });
});

describe("settings in test mode", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });

  const base = {
    APP_BASE_URL: "http://localhost:3000",
    ADMIN_PASSWORD_HASH: "$2b$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz12",
    SESSION_SECRET: "s".repeat(40),
    ENCRYPTION_KEY: "k".repeat(40),
    DATABASE_URL: "postgres://x",
    S3_ENDPOINT: "https://s3.example",
    S3_ACCESS_KEY_ID: "a",
    S3_SECRET_ACCESS_KEY: "b",
    S3_BUCKET_ORIGINALS: "o",
    S3_BUCKET_PUBLIC: "p",
    PUBLIC_PHOTO_BASE_URL: "https://p.sevalla.storage",
    ANTHROPIC_API_KEY: "x",
  };

  it("doesn't need eBay keys in test mode", async () => {
    process.env = { ...base, EBAY_ENV: "mock" } as any;
    const { env, isMockEbay } = await import("@/lib/env");
    expect(env().EBAY_ENV).toBe("mock");
    expect(isMockEbay()).toBe(true);
  });

  it("still requires eBay keys for the sandbox", async () => {
    process.env = { ...base, EBAY_ENV: "sandbox" } as any;
    const { env } = await import("@/lib/env");
    expect(() => env()).toThrow(/EBAY_CLIENT_ID: required when EBAY_ENV is sandbox/);
  });
});
