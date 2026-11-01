import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getPublicBytes } from "@/lib/storage";
import { categoryInfo, suggestCategories } from "@/lib/ebay/taxonomy";
import { findComps, median } from "@/lib/ebay/browse";
import { getAccount } from "@/lib/ebay/auth";
import { askStructured, type ImageInput } from "./claude";
import { draftFlags } from "./flags";
import {
  categoryChoiceSchema,
  chooseCategoryPrompt,
  chooseCategoryJsonSchema,
  identificationSchema,
  identifyPrompt,
  identifyJsonSchema,
  listingDraftSchema,
  writePrompt,
  writeJsonSchema,
} from "./prompts";

const MAX_PHOTOS_TO_CLAUDE = 8;

/**
 * Builds a new draft version for an item:
 * identify (photos) -> eBay category suggestions -> choose category ->
 * category specifics, conditions and price comps -> write the listing.
 * Phase 1 runs this inline when you press "Write draft"; Phase 2 moves it to the worker.
 */
export async function draftItem(itemId: string) {
  const [item] = await db().select().from(schema.items).where(eq(schema.items.id, itemId));
  if (!item) throw new Error("Item not found.");

  await db().update(schema.items).set({ status: "drafting", error: null }).where(eq(schema.items.id, itemId));

  try {
    const photos = await db()
      .select()
      .from(schema.photos)
      .where(and(eq(schema.photos.itemId, itemId), eq(schema.photos.isDivider, false)))
      .orderBy(asc(schema.photos.position));
    const usable = photos.filter((p) => p.listingKey).slice(0, MAX_PHOTOS_TO_CLAUDE);
    if (!usable.length) throw new Error("This item has no processed photos.");

    const images: ImageInput[] = await Promise.all(
      usable.map(async (p) => ({ data: await getPublicBytes(p.listingKey!), mediaType: "image/jpeg" as const })),
    );

    // 1. Identify
    const id = await askStructured({
      what: "identify the item",
      prompt: identifyPrompt({ photoCount: images.length, notesToAi: item.notesToAi, tested: item.tested }),
      jsonSchema: identifyJsonSchema,
      schema: identificationSchema,
      images,
      maxTokens: 6000,
    });

    // 2. Category: eBay suggests from its full tree, Claude picks
    const suggestions = await suggestCategories(id.keywords);
    if (!suggestions.length) throw new Error(`eBay had no category suggestions for "${id.keywords}".`);
    let chosen = suggestions[0];
    let categoryConfident = suggestions.length === 1;
    if (suggestions.length > 1) {
      const offered = suggestions.slice(0, 6);
      const choice = await askStructured({
        what: "choose the eBay category",
        prompt: chooseCategoryPrompt(id, offered),
        jsonSchema: chooseCategoryJsonSchema(offered),
        schema: categoryChoiceSchema,
        maxTokens: 3000,
        effort: "low",
      });
      chosen = suggestions.find((s) => s.categoryId === choice.categoryId) ?? suggestions[0];
      categoryConfident = choice.confident;
    }
    const info = await categoryInfo(chosen.categoryId, { name: chosen.name, path: chosen.path });

    // 3. Price comps (active listings)
    const comps = await findComps(id.keywords, chosen.categoryId).catch(() => []);
    const compMedian = median(comps.map((c) => c.price));

    // 4. Write
    const out = await askStructured({
      what: "write the listing",
      prompt: writePrompt({
        id,
        categoryPath: info.namePath,
        aspects: info.aspects,
        conditions: info.conditions,
        comps,
        compMedian,
        notesToAi: item.notesToAi,
        tested: item.tested,
      }),
      jsonSchema: writeJsonSchema(info.conditions.map((c) => c.conditionId)),
      schema: listingDraftSchema,
      images,
      maxTokens: 12000,
    });

    const conditionId = info.conditions.some((c) => c.conditionId === out.conditionId)
      ? out.conditionId
      : (info.conditions[0]?.conditionId ?? out.conditionId);
    const weightOz = out.weightOz ?? id.estimatedWeightOz;

    const flags = draftFlags({
      id,
      draft: { ...out, conditionId },
      categoryAspects: info.aspects,
      categoryConfident,
      compCount: comps.length,
      tested: item.tested,
      weightEstimated: weightOz !== undefined,
      sizeEstimated: out.packageIn !== undefined,
    });

    const [latest] = await db()
      .select({ version: schema.drafts.version })
      .from(schema.drafts)
      .where(eq(schema.drafts.itemId, itemId))
      .orderBy(desc(schema.drafts.version))
      .limit(1);
    const account = await getAccount();

    await db()
      .insert(schema.drafts)
      .values({
        itemId,
        version: (latest?.version ?? 0) + 1,
        source: "claude",
        categoryId: info.categoryId,
        categoryName: info.namePath,
        title: out.title,
        description: out.description,
        conditionId,
        conditionNotes: out.conditionNotes ?? null,
        aspects: out.aspects,
        price: out.price.toFixed(2),
        priceConfidence: out.priceConfidence,
        comps,
        shippingPolicyId: account?.defaultShippingPolicyId ?? null,
        weightOz: weightOz ? weightOz.toFixed(2) : null,
        dims: out.packageIn ?? null,
        aiNotes: [id.notes, out.notes, out.priceReasoning && `Price: ${out.priceReasoning}`].filter(Boolean).join("\n") || null,
      });

    await db()
      .update(schema.items)
      .set({ status: "needs_review", groupType: id.groupType, flags })
      .where(eq(schema.items.id, itemId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db().update(schema.items).set({ status: "failed", error: message }).where(eq(schema.items.id, itemId));
    throw err;
  }
}
