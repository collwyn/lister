import type { Aspects, CachedAspect, Dims } from "@/db/schema";
import { allowsConditionNotes, conditionEnum } from "./conditions";

// Pure functions that turn a reviewed draft into eBay request bodies.
// Kept free of I/O so they are unit-tested (tests/listing.test.ts).

export const TITLE_MAX = 80;
const ASPECT_NAME_MAX = 40;
const ASPECT_VALUE_MAX = 65;
const PRODUCT_DESCRIPTION_MAX = 4000;

export type ListingInput = {
  sku: string;
  title: string;
  description: string;
  categoryId: string;
  conditionId: string;
  conditionNotes?: string | null;
  aspects: Aspects;
  price: number;
  currency?: string;
  quantity: number;
  imageUrls: string[];
  weightOz?: number | null;
  dims?: Dims | null;
  marketplaceId: string;
  policies: { paymentPolicyId: string; returnPolicyId: string; fulfillmentPolicyId: string };
  merchantLocationKey: string;
};

export function cleanAspects(aspects: Aspects): Aspects {
  const out: Aspects = {};
  for (const [rawName, rawValues] of Object.entries(aspects ?? {})) {
    const name = rawName.trim().slice(0, ASPECT_NAME_MAX);
    const values = [...new Set((rawValues ?? []).map((v) => String(v).trim().slice(0, ASPECT_VALUE_MAX)).filter(Boolean))];
    if (name && values.length) out[name] = values;
  }
  return out;
}

export function missingRequiredAspects(aspects: Aspects, categoryAspects: CachedAspect[]): string[] {
  const cleaned = cleanAspects(aspects);
  return categoryAspects.filter((a) => a.required && !cleaned[a.name]?.length).map((a) => a.name);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain-text description (blank-line paragraphs, "- " bullets) to simple, safe HTML. */
export function descriptionHtml(text: string): string {
  const blocks = text.trim().split(/\n\s*\n/);
  return blocks
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => /^[-*•]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${escapeHtml(l.replace(/^[-*•]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
    })
    .join("\n");
}

export function validateListing(input: ListingInput): string[] {
  const problems: string[] = [];
  if (!input.title.trim()) problems.push("Add a title.");
  if (input.title.length > TITLE_MAX) problems.push(`Shorten the title to ${TITLE_MAX} characters.`);
  if (!input.description.trim()) problems.push("Add a description.");
  if (!input.categoryId) problems.push("Choose a category.");
  if (!conditionEnum(input.conditionId)) problems.push("Choose a condition.");
  if (!(input.price > 0)) problems.push("Set a price above $0.");
  if (!(input.quantity >= 1)) problems.push("Quantity must be at least 1.");
  if (!input.imageUrls.length) problems.push("Add at least one photo.");
  if (input.imageUrls.length > 24) problems.push("eBay allows at most 24 photos.");
  if (!input.policies.paymentPolicyId || !input.policies.returnPolicyId || !input.policies.fulfillmentPolicyId)
    problems.push("Pick payment, return and shipping policies in Settings.");
  if (!input.merchantLocationKey) problems.push("Add your ship-from location in Settings.");
  return problems;
}

export function inventoryItemBody(input: ListingInput) {
  const body: Record<string, unknown> = {
    availability: { shipToLocationAvailability: { quantity: input.quantity } },
    condition: conditionEnum(input.conditionId),
    product: {
      title: input.title.trim().slice(0, TITLE_MAX),
      description: input.description.trim().slice(0, PRODUCT_DESCRIPTION_MAX),
      aspects: cleanAspects(input.aspects),
      imageUrls: input.imageUrls.slice(0, 24),
    },
  };
  if (input.conditionNotes?.trim() && allowsConditionNotes(input.conditionId)) {
    body.conditionDescription = input.conditionNotes.trim().slice(0, 1000);
  }
  if (input.weightOz || input.dims) {
    body.packageWeightAndSize = {
      ...(input.weightOz ? { weight: { value: input.weightOz, unit: "OUNCE" } } : {}),
      ...(input.dims
        ? {
            dimensions: {
              length: input.dims.lengthIn,
              width: input.dims.widthIn,
              height: input.dims.heightIn,
              unit: "INCH",
            },
          }
        : {}),
    };
  }
  return body;
}

export function offerBody(input: ListingInput) {
  return {
    sku: input.sku,
    marketplaceId: input.marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: input.quantity,
    categoryId: input.categoryId,
    listingDescription: descriptionHtml(input.description),
    listingPolicies: {
      paymentPolicyId: input.policies.paymentPolicyId,
      returnPolicyId: input.policies.returnPolicyId,
      fulfillmentPolicyId: input.policies.fulfillmentPolicyId,
    },
    pricingSummary: { price: { value: input.price.toFixed(2), currency: input.currency ?? "USD" } },
    merchantLocationKey: input.merchantLocationKey,
  };
}
