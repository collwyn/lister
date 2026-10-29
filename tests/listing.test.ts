import { describe, expect, it } from "vitest";
import {
  cleanAspects,
  descriptionHtml,
  inventoryItemBody,
  missingRequiredAspects,
  offerBody,
  validateListing,
  type ListingInput,
} from "@/lib/ebay/listing";
import type { CachedAspect } from "@/db/schema";

const base: ListingInput = {
  sku: "item-123",
  title: "Sony WH-1000XM4 Wireless Noise Cancelling Headphones Black",
  description: "Sony headphones in good used condition.\n\n- Case included\n- USB-C cable included",
  categoryId: "112529",
  conditionId: "3000",
  conditionNotes: "Light wear on the headband.",
  aspects: { Brand: ["Sony"], Model: ["WH-1000XM4"] },
  price: 129.5,
  quantity: 1,
  imageUrls: ["https://photos.example/p/a.jpg", "https://photos.example/p/b.jpg"],
  weightOz: 24,
  marketplaceId: "EBAY_US",
  policies: { paymentPolicyId: "pay1", returnPolicyId: "ret1", fulfillmentPolicyId: "ship1" },
  merchantLocationKey: "home",
};

describe("cleanAspects", () => {
  it("trims, de-duplicates and drops empty values", () => {
    expect(cleanAspects({ " Brand ": ["Sony", "Sony ", ""], Color: [], Type: ["  "] })).toEqual({ Brand: ["Sony"] });
  });
  it("caps value length at 65 characters", () => {
    const out = cleanAspects({ Features: ["x".repeat(100)] });
    expect(out.Features[0]).toHaveLength(65);
  });
});

describe("missingRequiredAspects", () => {
  const aspects: CachedAspect[] = [
    { name: "Brand", required: true, usage: "RECOMMENDED", mode: "FREE_TEXT", multi: false, values: [] },
    { name: "Type", required: true, usage: "RECOMMENDED", mode: "SELECTION_ONLY", multi: false, values: ["Over-Ear"] },
    { name: "Color", required: false, usage: "RECOMMENDED", mode: "FREE_TEXT", multi: false, values: [] },
  ];
  it("lists required specifics that are blank", () => {
    expect(missingRequiredAspects({ Brand: ["Sony"], Type: [" "] }, aspects)).toEqual(["Type"]);
  });
});

describe("descriptionHtml", () => {
  it("makes paragraphs and bullet lists", () => {
    expect(descriptionHtml(base.description)).toBe(
      "<p>Sony headphones in good used condition.</p>\n<ul><li>Case included</li><li>USB-C cable included</li></ul>",
    );
  });
  it("escapes HTML so a description can't inject markup", () => {
    expect(descriptionHtml('<script>alert("x")</script> & more')).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more</p>",
    );
  });
  it("keeps single line breaks inside a paragraph", () => {
    expect(descriptionHtml("line one\nline two")).toBe("<p>line one<br>line two</p>");
  });
});

describe("validateListing", () => {
  it("passes a complete listing", () => {
    expect(validateListing(base)).toEqual([]);
  });
  it("explains every missing piece", () => {
    const problems = validateListing({
      ...base,
      title: "x".repeat(81),
      categoryId: "",
      conditionId: "9999",
      price: 0,
      imageUrls: [],
      policies: { paymentPolicyId: "", returnPolicyId: "r", fulfillmentPolicyId: "s" },
      merchantLocationKey: "",
    });
    expect(problems).toEqual([
      "Shorten the title to 80 characters.",
      "Choose a category.",
      "Choose a condition.",
      "Set a price above $0.",
      "Add at least one photo.",
      "Pick payment, return and shipping policies in Settings.",
      "Add your ship-from location in Settings.",
    ]);
  });
});

describe("inventoryItemBody", () => {
  it("maps condition IDs to Inventory API enums and includes condition notes for used items", () => {
    const body = inventoryItemBody(base) as Record<string, any>;
    expect(body.condition).toBe("USED_EXCELLENT");
    expect(body.conditionDescription).toBe("Light wear on the headband.");
    expect(body.availability.shipToLocationAvailability.quantity).toBe(1);
    expect(body.product.imageUrls).toHaveLength(2);
    expect(body.product.aspects).toEqual({ Brand: ["Sony"], Model: ["WH-1000XM4"] });
    expect(body.packageWeightAndSize).toEqual({ weight: { value: 24, unit: "OUNCE" } });
  });
  it("leaves out condition notes on new items", () => {
    const body = inventoryItemBody({ ...base, conditionId: "1000" }) as Record<string, any>;
    expect(body.condition).toBe("NEW");
    expect(body.conditionDescription).toBeUndefined();
  });
  it("maps for-parts condition", () => {
    expect((inventoryItemBody({ ...base, conditionId: "7000" }) as any).condition).toBe("FOR_PARTS_OR_NOT_WORKING");
  });
});

describe("offerBody", () => {
  it("formats the price with two decimals and carries policies and location", () => {
    const offer = offerBody(base);
    expect(offer.pricingSummary.price).toEqual({ value: "129.50", currency: "USD" });
    expect(offer.format).toBe("FIXED_PRICE");
    expect(offer.listingPolicies).toEqual({ paymentPolicyId: "pay1", returnPolicyId: "ret1", fulfillmentPolicyId: "ship1" });
    expect(offer.merchantLocationKey).toBe("home");
    expect(offer.listingDescription).toContain("<ul>");
  });
});
