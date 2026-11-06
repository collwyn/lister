import type { CachedAspect } from "@/db/schema";
import { missingRequiredAspects } from "@/lib/ebay/listing";
import { FOR_PARTS } from "@/lib/ebay/conditions";
import { effectiveTested, type Identification, type ListingDraftOutput } from "./prompts";

// Flags put a draft at the front of the review queue and tell you what to check.

export function draftFlags(opts: {
  id: Identification;
  draft: Pick<ListingDraftOutput, "aspects" | "priceConfidence" | "conditionId">;
  categoryAspects: CachedAspect[];
  categoryConfident: boolean;
  compCount: number;
  tested?: string | null;
  weightEstimated: boolean;
  sizeEstimated?: boolean;
}): string[] {
  const flags: string[] = [];
  const missing = missingRequiredAspects(opts.draft.aspects, opts.categoryAspects);
  if (missing.length) flags.push(`Fill required item specifics: ${missing.join(", ")}`);
  if (!opts.categoryConfident) flags.push("Check the category");
  if (opts.id.identificationConfidence === "low") flags.push("Check the identification");
  if (opts.draft.priceConfidence === "low" || opts.compCount < 3) flags.push("Check the price");
  if (effectiveTested(opts.tested) === "works" && opts.draft.conditionId === FOR_PARTS) {
    flags.push("Condition says for parts, but the item works");
  }
  if (opts.weightEstimated) flags.push("Weight is an estimate");
  if (opts.sizeEstimated) flags.push("Box size is an estimate");
  return flags;
}
