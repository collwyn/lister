import { describe, expect, it } from "vitest";
import { draftFlags } from "@/lib/drafting/flags";
import { identificationSchema, listingDraftSchema, writePrompt } from "@/lib/drafting/prompts";
import { trimAspects } from "@/lib/ebay/taxonomy";
import { median } from "@/lib/ebay/browse";
import { exifDate } from "@/lib/images";
import type { CachedAspect } from "@/db/schema";

const aspects: CachedAspect[] = [
  { name: "Brand", required: true, usage: "RECOMMENDED", mode: "FREE_TEXT", multi: false, values: ["Sony", "Bose"] },
  { name: "Connectivity", required: false, usage: "RECOMMENDED", mode: "SELECTION_ONLY", multi: true, values: ["Bluetooth", "Wired"] },
];

const id = identificationSchema.parse({
  groupType: "electronics",
  whatItIs: "Sony wireless headphones",
  keywords: "sony wh-1000xm4 headphones",
  visibleCondition: "used, light wear",
  flaws: ["scuff on left cup"],
  sizeClass: "small",
  identificationConfidence: "high",
});

describe("draftFlags", () => {
  it("flags missing required specifics and thin price data", () => {
    const flags = draftFlags({
      id,
      draft: { aspects: { Connectivity: ["Bluetooth"] }, priceConfidence: "medium", conditionId: "3000" },
      categoryAspects: aspects,
      categoryConfident: true,
      compCount: 1,
      tested: null,
      weightEstimated: true,
    });
    expect(flags).toEqual([
      "Fill required item specifics: Brand",
      "Check the price",
      "Weight is an estimate",
    ]);
  });

  it("catches a 'for parts' condition on a working item, which is the default", () => {
    const flags = draftFlags({
      id,
      draft: { aspects: { Brand: ["Sony"] }, priceConfidence: "high", conditionId: "7000" },
      categoryAspects: aspects,
      categoryConfident: true,
      compCount: 12,
      tested: null,
      weightEstimated: false,
    });
    expect(flags).toEqual(["Condition says for parts, but the item works"]);
    expect(
      draftFlags({
        id,
        draft: { aspects: { Brand: ["Sony"] }, priceConfidence: "high", conditionId: "7000" },
        categoryAspects: aspects,
        categoryConfident: true,
        compCount: 12,
        tested: "not_working",
        weightEstimated: false,
      }),
    ).toEqual([]);
  });
});

describe("output schemas", () => {
  it("falls back safely on unexpected identification values", () => {
    const parsed = identificationSchema.parse({ ...id, groupType: "furniture", sizeClass: "huge", keywords: "x".repeat(120) });
    expect(parsed.groupType).toBe("other");
    expect(parsed.sizeClass).toBe("medium");
    expect(parsed.keywords).toHaveLength(80);
  });

  it("clips the title to 80 characters and coerces aspect values to strings", () => {
    const parsed = listingDraftSchema.parse({
      title: "t".repeat(90),
      description: "d",
      conditionId: "3000",
      aspects: { Year: [1987] },
      price: 12,
      priceConfidence: "medium",
    });
    expect(parsed.title).toHaveLength(80);
    expect(parsed.aspects).toEqual({ Year: ["1987"] });
  });
});

describe("writePrompt", () => {
  it("lists required specifics first and defaults to used and working", () => {
    const prompt = writePrompt({
      id,
      categoryPath: "Consumer Electronics > Headphones",
      aspects: [...aspects].reverse(),
      conditions: [
        { conditionId: "3000", conditionDescription: "Used" },
        { conditionId: "7000", conditionDescription: "For parts or not working" },
      ],
      comps: [{ title: "Sony XM4", price: 140, currency: "USD" }],
      compMedian: 140,
    });
    expect(prompt.indexOf("- Brand [REQUIRED")).toBeLessThan(prompt.indexOf("- Connectivity"));
    expect(prompt).toContain("used and in working order");
    expect(prompt).toContain("Never pick 'For parts or not working'");
    expect(prompt).not.toContain("untested.");
    expect(prompt).toContain("Median: $140.00");
  });

  it("follows the seller's working-order status and a condition picked on the review screen", () => {
    const base = {
      id,
      categoryPath: "Consumer Electronics > Headphones",
      aspects,
      conditions: [{ conditionId: "3000", conditionDescription: "Used" }],
      comps: [],
      compMedian: null,
    };
    expect(writePrompt({ ...base, tested: "not_working" })).toContain("Use 'For parts or not working' (7000)");
    expect(writePrompt({ ...base, tested: "untested" })).toContain("it is untested");
    const kept = writePrompt({ ...base, chosenCondition: { id: "4000", name: "Very Good" } });
    expect(kept).toContain("the seller chose condition 4000 (Very Good). Use exactly that conditionId");
    expect(kept).not.toContain("Never pick");
  });
});

describe("helpers", () => {
  it("trims eBay aspect metadata", () => {
    const out = trimAspects({
      aspects: [
        {
          localizedAspectName: "Brand",
          aspectConstraint: { aspectRequired: true, aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT", itemToAspectCardinality: "SINGLE" },
          aspectValues: [{ localizedValue: "Sony" }, { localizedValue: "Bose" }],
        },
      ],
    });
    expect(out).toEqual([{ name: "Brand", required: true, usage: "RECOMMENDED", mode: "FREE_TEXT", multi: false, values: ["Sony", "Bose"] }]);
  });

  it("computes a median", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("reads DateTimeOriginal from an EXIF block", () => {
    const exif = Buffer.from("Exif\0\0junk2024:05:17 14:03:22junk", "latin1");
    expect(exifDate(exif)?.getFullYear()).toBe(2024);
    expect(exifDate(undefined)).toBeNull();
  });
});
