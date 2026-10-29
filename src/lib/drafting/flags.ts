import type { CachedAspect } from "@/db/schema";
import { missingRequiredAspects } from "@/lib/ebay/listing";
import { FOR_PARTS } from "@/lib/ebay/conditions";
import type { Identification, ListingDraftOutput } from "./prompts";

// Flags put a draft at the front of the review queue and tell you what to check.

export function draftFlags(opts: {
  id: Identification;
  draft: Pick<ListingDraftOutput, "aspects" | "priceConfidence" | "conditionId">;
  categoryAspects: CachedAspect[];
  categoryConfident: boolean;
  compCount: number;
  tested?: string | null;
  weightEstimated: boolean;
}): string[] {
  const flags: string[] = [];
  const missing = missingRequiredAspects(opts.draft.aspects, opts.categoryAspects);
  if (missing.length) flags.push(`Fill required item specifics: ${missing.join(", ")}`);
  if (!opts.categoryConfident) flags.push("Check the category");
  if (opts.id.identificationConfidence === "low") flags.push("Check the identification");
  if (opts.draft.priceConfidence === "low" || opts.compCount < 3) flags.push("Check the price");
  if (opts.id.groupType === "electronics" && !opts.tested) flags.push("Confirm tested / works");
  if (opts.id.groupType === "electronics" && opts.tested === "works" && opts.draft.conditionId === FOR_PARTS) {
    flags.push("Condition says for parts, but you marked it working");
  }
  if (opts.weightEstimated) flags.push("Weight is an estimate");
  return flags;
}
