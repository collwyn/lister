import { z } from "zod";
import type { CachedAspect, CachedCondition, Comp } from "@/db/schema";
import type { CategorySuggestion } from "@/lib/ebay/taxonomy";

// Prompts and output schemas for the three drafting calls:
//   1. identify  (photos)        -> what the item is, search keywords, visible condition
//   2. choose    (text only)     -> which eBay category, from eBay's own suggestions
//   3. write     (photos + data) -> the full listing draft
// Each call forces a tool so Claude's answer arrives as JSON; zod checks it.

export const GROUP_TYPES = ["comics", "books", "magazines", "electronics", "household", "other"] as const;

export const identifyTool = {
  name: "record_identification",
  description: "Record what the item in the photos is.",
  input_schema: {
    type: "object" as const,
    properties: {
      groupType: { type: "string", enum: [...GROUP_TYPES] },
      whatItIs: { type: "string", description: "Plain description, e.g. 'Sony WH-1000XM4 wireless headphones, black'." },
      brand: { type: "string" },
      model: { type: "string", description: "Model, part number, ISBN, issue number or edition, if visible." },
      keywords: {
        type: "string",
        description: "An eBay search query (max 80 characters) a buyer would type to find this exact item.",
      },
      visibleCondition: { type: "string", description: "Condition as seen in the photos." },
      flaws: { type: "array", items: { type: "string" }, description: "Each flaw visible in the photos." },
      sizeClass: { type: "string", enum: ["media", "small", "medium", "large", "oversize"] },
      estimatedWeightOz: { type: "number", description: "Packed shipping weight estimate in ounces." },
      identificationConfidence: { type: "string", enum: ["low", "medium", "high"] },
      notes: { type: "string", description: "Anything the seller should check, e.g. 'model number not visible'." },
    },
    required: ["groupType", "whatItIs", "keywords", "visibleCondition", "flaws", "sizeClass", "identificationConfidence"],
  },
};

export const identificationSchema = z.object({
  groupType: z.enum(GROUP_TYPES).catch("other"),
  whatItIs: z.string(),
  brand: z.string().optional(),
  model: z.string().optional(),
  keywords: z.string().transform((s) => s.slice(0, 80)),
  visibleCondition: z.string(),
  flaws: z.array(z.string()).catch([]),
  sizeClass: z.enum(["media", "small", "medium", "large", "oversize"]).catch("medium"),
  estimatedWeightOz: z.number().positive().optional().catch(undefined),
  identificationConfidence: z.enum(["low", "medium", "high"]).catch("low"),
  notes: z.string().optional(),
});
export type Identification = z.infer<typeof identificationSchema>;

export function identifyPrompt(opts: { photoCount: number; notesToAi?: string | null; tested?: string | null }) {
  return [
    `These ${opts.photoCount} photo${opts.photoCount === 1 ? "" : "s"} all show ONE item a seller wants to list on eBay (US).`,
    "Identify it as precisely as the photos allow: brand, model or part number, edition, issue number, ISBN.",
    "Only state what you can see or reliably infer. If a detail is not visible, say so in notes rather than guessing.",
    "Describe condition honestly, listing every visible flaw. Buyers return items that are worse than described.",
    opts.tested ? `Seller says testing status is: ${opts.tested}.` : "",
    opts.notesToAi ? `Seller's note about this item: ${opts.notesToAi}` : "",
    "Record your answer with the record_identification tool.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const chooseCategoryTool = {
  name: "choose_category",
  description: "Pick the eBay category that best fits the item.",
  input_schema: {
    type: "object" as const,
    properties: {
      categoryId: { type: "string", description: "One of the categoryId values offered." },
      confident: { type: "boolean", description: "False if two or more options fit about equally well." },
      reason: { type: "string" },
    },
    required: ["categoryId", "confident"],
  },
};

export const categoryChoiceSchema = z.object({
  categoryId: z.string(),
  confident: z.boolean().catch(false),
  reason: z.string().optional(),
});

export function chooseCategoryPrompt(id: Identification, suggestions: CategorySuggestion[]) {
  return [
    `Item: ${id.whatItIs}${id.brand ? ` (brand: ${id.brand})` : ""}${id.model ? ` (model/edition: ${id.model})` : ""}.`,
    "eBay suggested these categories:",
    ...suggestions.map((s) => `- ${s.categoryId}: ${s.path}`),
    "Choose the single best one with the choose_category tool.",
  ].join("\n");
}

export const writeTool = {
  name: "write_listing",
  description: "Write the complete eBay listing draft.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description:
          "Max 80 characters. Order: brand, model, key specs, condition note if useful. No ALL CAPS words, no emoji, no 'L@@K' or 'WOW'.",
      },
      description: {
        type: "string",
        description:
          "Plain text. Short paragraphs separated by blank lines; bullet lines start with '- '. Cover: what it is, what's included, condition and every visible flaw, testing status. No shipping or return terms (eBay shows those).",
      },
      conditionId: { type: "string", description: "One conditionId from the allowed list." },
      conditionNotes: { type: "string", description: "One or two sentences on condition for the condition field." },
      aspects: {
        type: "object",
        description:
          "Item specifics: { aspect name: [value, ...] }. Use the exact aspect names given. For SELECTION_ONLY aspects use only listed values. Leave out anything you cannot see or reliably know.",
        additionalProperties: { type: "array", items: { type: "string" } },
      },
      price: { type: "number", description: "Suggested Buy It Now price in USD." },
      priceConfidence: { type: "string", enum: ["low", "medium", "high"] },
      priceReasoning: { type: "string" },
      weightOz: { type: "number", description: "Packed shipping weight estimate in ounces." },
      notes: { type: "string", description: "What the seller should double-check before approving." },
    },
    required: ["title", "description", "conditionId", "aspects", "price", "priceConfidence"],
  },
};

export const listingDraftSchema = z.object({
  title: z.string().transform((s) => s.trim().slice(0, 80)),
  description: z.string(),
  conditionId: z.string(),
  conditionNotes: z.string().optional(),
  aspects: z.record(z.array(z.coerce.string())).catch({}),
  price: z.number().nonnegative(),
  priceConfidence: z.enum(["low", "medium", "high"]).catch("low"),
  priceReasoning: z.string().optional(),
  weightOz: z.number().positive().optional().catch(undefined),
  notes: z.string().optional(),
});
export type ListingDraftOutput = z.infer<typeof listingDraftSchema>;

function aspectLine(a: CachedAspect): string {
  const tag = a.required ? "REQUIRED" : a.usage === "RECOMMENDED" ? "recommended" : "optional";
  const mode = a.mode === "SELECTION_ONLY" ? "pick from list" : "free text";
  const values = a.values.length ? `; values: ${a.values.slice(0, 40).join(" | ")}` : "";
  return `- ${a.name} [${tag}, ${mode}${a.multi ? ", multiple allowed" : ""}${values}]`;
}

export function writePrompt(opts: {
  id: Identification;
  categoryPath: string;
  aspects: CachedAspect[];
  conditions: CachedCondition[];
  comps: Comp[];
  compMedian: number | null;
  notesToAi?: string | null;
  tested?: string | null;
}) {
  const aspects = [...opts.aspects]
    .sort((a, b) => Number(b.required) - Number(a.required) || (a.usage === "RECOMMENDED" ? -1 : 1))
    .slice(0, 45);
  const comps = opts.comps.slice(0, 15);
  return [
    "Write an eBay (US) listing for the item in these photos.",
    `Identification: ${JSON.stringify(opts.id)}`,
    opts.tested ? `Testing status from the seller: ${opts.tested}.` : "",
    opts.notesToAi ? `Seller's note: ${opts.notesToAi}` : "",
    `Category: ${opts.categoryPath}`,
    "",
    "Allowed conditions (use one conditionId):",
    ...opts.conditions.map((c) => `- ${c.conditionId}: ${c.conditionDescription}`),
    opts.id.groupType === "electronics"
      ? "Electronics rule: unless the seller says it was tested and works, use the 'For parts or not working' condition (7000) if allowed, and say it is untested."
      : "",
    "",
    "Item specifics for this category:",
    ...aspects.map(aspectLine),
    "",
    comps.length
      ? `Comparable ACTIVE fixed-price listings (asking prices; sold prices usually run lower). Median: $${opts.compMedian?.toFixed(2)}`
      : "No comparable listings were found; estimate from your own knowledge and mark price confidence low.",
    ...comps.map((c) => `- $${c.price.toFixed(2)} ${c.condition ?? ""} | ${c.title}`),
    "",
    "Price to sell within a few weeks: usually a little under the median of comparable listings in similar condition, adjusted for this item's condition and completeness.",
    "Be accurate and specific. Never invent specs, accessories or test results you cannot see.",
    "Record the draft with the write_listing tool.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
