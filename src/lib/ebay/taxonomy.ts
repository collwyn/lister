import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { CachedAspect, CachedCondition } from "@/db/schema";
import { env } from "@/lib/env";
import { appToken } from "./auth";
import { ebayFetch } from "./http";

// Every item can go in any eBay category: the app works from eBay's full,
// current category tree rather than a list of its own.

type TreeId = { categoryTreeId: string; categoryTreeVersion: string };
let treeMemo: { value: TreeId; at: number } | null = null;
const TREE_TTL_MS = 24 * 60 * 60 * 1000;

export async function categoryTree(): Promise<TreeId> {
  if (treeMemo && Date.now() - treeMemo.at < TREE_TTL_MS) return treeMemo.value;
  const value = await ebayFetch<TreeId>("/commerce/taxonomy/v1/get_default_category_tree_id", await appToken(), {
    query: { marketplace_id: env().EBAY_MARKETPLACE_ID },
  });
  treeMemo = { value, at: Date.now() };
  return value;
}

export type CategorySuggestion = { categoryId: string; name: string; path: string };

type SuggestionsResponse = {
  categorySuggestions?: {
    category: { categoryId: string; categoryName: string };
    categoryTreeNodeAncestors?: { categoryName: string; categoryTreeNodeLevel: number }[];
  }[];
};

export async function suggestCategories(query: string): Promise<CategorySuggestion[]> {
  const q = query.trim().slice(0, 350);
  if (!q) return [];
  const tree = await categoryTree();
  const res = await ebayFetch<SuggestionsResponse>(
    `/commerce/taxonomy/v1/category_tree/${tree.categoryTreeId}/get_category_suggestions`,
    await appToken(),
    { query: { q } },
  );
  return (res.categorySuggestions ?? []).slice(0, 10).map((s) => {
    const ancestors = [...(s.categoryTreeNodeAncestors ?? [])]
      .sort((a, b) => a.categoryTreeNodeLevel - b.categoryTreeNodeLevel)
      .map((a) => a.categoryName);
    return {
      categoryId: s.category.categoryId,
      name: s.category.categoryName,
      path: [...ancestors, s.category.categoryName].join(" > "),
    };
  });
}

type AspectsResponse = {
  aspects?: {
    localizedAspectName: string;
    aspectConstraint: {
      aspectRequired?: boolean;
      aspectUsage?: string;
      aspectMode?: string;
      itemToAspectCardinality?: string;
    };
    aspectValues?: { localizedValue: string }[];
  }[];
};

/** Trims eBay's aspect metadata to what drafting and the review form need. */
export function trimAspects(res: AspectsResponse, maxValues = 60): CachedAspect[] {
  return (res.aspects ?? []).map((a) => ({
    name: a.localizedAspectName,
    required: !!a.aspectConstraint.aspectRequired,
    usage: a.aspectConstraint.aspectUsage ?? "OPTIONAL",
    mode: a.aspectConstraint.aspectMode ?? "FREE_TEXT",
    multi: a.aspectConstraint.itemToAspectCardinality === "MULTI",
    values: (a.aspectValues ?? []).slice(0, maxValues).map((v) => v.localizedValue),
  }));
}

type ConditionPoliciesResponse = {
  itemConditionPolicies?: {
    categoryId: string;
    itemConditionRequired?: boolean;
    itemConditions?: { conditionId: string; conditionDescription: string }[];
  }[];
};

export type CategoryInfo = {
  categoryId: string;
  name: string;
  namePath: string;
  aspects: CachedAspect[];
  conditions: CachedCondition[];
  conditionRequired: boolean;
};

/**
 * Item specifics and allowed conditions for one category, cached in Postgres.
 * The cache refreshes whenever eBay publishes a new category tree version.
 */
export async function categoryInfo(categoryId: string, nameHint?: { name: string; path: string }): Promise<CategoryInfo> {
  const tree = await categoryTree();
  const [cached] = await db().select().from(schema.categoryCache).where(eq(schema.categoryCache.categoryId, categoryId));
  if (cached && cached.treeVersion === tree.categoryTreeVersion) {
    return {
      categoryId,
      name: cached.name,
      namePath: cached.namePath,
      aspects: cached.aspects,
      conditions: cached.conditions,
      conditionRequired: cached.conditionRequired,
    };
  }

  const token = await appToken();
  const [aspectsRes, conditionsRes] = await Promise.all([
    ebayFetch<AspectsResponse>(
      `/commerce/taxonomy/v1/category_tree/${tree.categoryTreeId}/get_item_aspects_for_category`,
      token,
      { query: { category_id: categoryId } },
    ),
    ebayFetch<ConditionPoliciesResponse>(
      `/sell/metadata/v1/marketplace/${env().EBAY_MARKETPLACE_ID}/get_item_condition_policies`,
      token,
      { query: { filter: `categoryIds:{${categoryId}}` } },
    ),
  ]);

  const policy = conditionsRes.itemConditionPolicies?.[0];
  const info: CategoryInfo = {
    categoryId,
    name: nameHint?.name ?? cached?.name ?? categoryId,
    namePath: nameHint?.path ?? cached?.namePath ?? nameHint?.name ?? categoryId,
    aspects: trimAspects(aspectsRes),
    conditions: (policy?.itemConditions ?? []).map((c) => ({
      conditionId: c.conditionId,
      conditionDescription: c.conditionDescription,
    })),
    conditionRequired: policy?.itemConditionRequired ?? true,
  };

  const row = { ...info, treeVersion: tree.categoryTreeVersion, fetchedAt: new Date() };
  await db()
    .insert(schema.categoryCache)
    .values(row)
    .onConflictDoUpdate({ target: schema.categoryCache.categoryId, set: row });
  return info;
}
