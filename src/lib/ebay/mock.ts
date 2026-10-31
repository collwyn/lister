import { EbayError } from "./errors";

// A local stand-in for eBay's APIs, used when EBAY_ENV=mock. It lets you test
// uploads, Claude drafting, review and the publish flow before eBay approves
// your developer account. Nothing here reaches eBay.
//
// The categories below are TEST FIXTURES ONLY (ids start with "mock-"). Real
// sandbox/production modes always use eBay's live category tree.

type Aspect = { name: string; required?: boolean; values?: string[]; select?: boolean; multi?: boolean };
type MockCategory = { id: string; path: string; keywords: string[]; aspects: Aspect[]; conditions: string[] };

const GENERAL = ["1000", "1500", "3000", "7000"];
const MEDIA = ["1000", "2750", "4000", "5000", "6000"];
const brand: Aspect = { name: "Brand", required: true };

export const MOCK_CATEGORIES: MockCategory[] = [
  {
    id: "mock-comics",
    path: "Collectibles > Comic Books & Memorabilia > Comics > Comics & Graphic Novels",
    keywords: ["comic", "comics", "marvel", "dc", "issue", "graphic", "novel", "spider", "batman", "superman", "x-men"],
    aspects: [
      { name: "Publisher", required: true },
      { name: "Series Title" },
      { name: "Issue Number" },
      { name: "Publication Year" },
      { name: "Era", values: ["Golden Age (1938-55)", "Silver Age (1956-69)", "Bronze Age (1970-83)", "Copper Age (1984-91)", "Modern Age (1992-Now)"], select: true },
      { name: "Grade", values: ["Ungraded"] },
    ],
    conditions: ["2750", "4000", "5000", "6000"],
  },
  {
    id: "mock-books",
    path: "Books & Magazines > Books",
    keywords: ["book", "books", "hardcover", "paperback", "novel", "isbn", "edition", "author", "cookbook"],
    aspects: [
      { name: "Book Title", required: true },
      { name: "Author", required: true },
      { name: "Language", required: true, values: ["English", "Spanish", "French"] },
      { name: "Format", values: ["Hardcover", "Paperback", "Mass Market Paperback"], select: true },
      { name: "ISBN" },
      { name: "Publication Year" },
      { name: "Edition" },
    ],
    conditions: MEDIA,
  },
  {
    id: "mock-magazines",
    path: "Books & Magazines > Magazines",
    keywords: ["magazine", "magazines", "issue", "periodical", "vogue", "life", "time", "rolling", "stone"],
    aspects: [
      { name: "Publication Name", required: true },
      { name: "Publication Year" },
      { name: "Publication Month" },
      { name: "Subject" },
      { name: "Language", values: ["English"] },
    ],
    conditions: MEDIA,
  },
  {
    id: "mock-headphones",
    path: "Consumer Electronics > Portable Audio & Headphones > Headphones",
    keywords: ["headphones", "headphone", "earbuds", "earphones", "headset", "audio", "sony", "bose", "beats"],
    aspects: [
      brand,
      { name: "Model" },
      { name: "Type", required: true, values: ["Ear-Cup (Over the Ear)", "Earbud (In Ear)", "On-Ear"], select: true },
      { name: "Connectivity", values: ["Bluetooth", "Wired", "Wireless"], multi: true },
      { name: "Color" },
    ],
    conditions: GENERAL,
  },
  {
    id: "mock-cameras",
    path: "Cameras & Photo > Film Photography > Film Cameras",
    keywords: ["camera", "cameras", "film", "35mm", "slr", "lens", "canon", "nikon", "minolta", "polaroid", "kodak"],
    aspects: [brand, { name: "Model" }, { name: "Type", values: ["SLR", "Rangefinder", "Point & Shoot", "Instant"] }, { name: "Format", values: ["35mm", "120", "Instant"] }],
    conditions: GENERAL,
  },
  {
    id: "mock-video-games",
    path: "Video Games & Consoles > Video Games",
    keywords: ["game", "games", "video", "nintendo", "playstation", "xbox", "sega", "cartridge", "disc"],
    aspects: [
      { name: "Platform", required: true },
      { name: "Game Name", required: true },
      { name: "Region Code", values: ["NTSC-U/C (US/Canada)", "PAL", "NTSC-J (Japan)", "Region Free"], select: true },
      { name: "Rating" },
    ],
    conditions: ["1000", "3000"],
  },
  {
    id: "mock-consoles",
    path: "Video Games & Consoles > Video Game Consoles",
    keywords: ["console", "consoles", "nintendo", "playstation", "xbox", "sega", "system", "handheld"],
    aspects: [brand, { name: "Platform", required: true }, { name: "Model" }, { name: "Color" }],
    conditions: GENERAL,
  },
  {
    id: "mock-electronics-other",
    path: "Consumer Electronics > Other Consumer Electronics",
    keywords: ["electronics", "electronic", "radio", "speaker", "remote", "charger", "player", "stereo", "clock", "calculator"],
    aspects: [brand, { name: "Model" }, { name: "Type" }, { name: "Color" }],
    conditions: GENERAL,
  },
  {
    id: "mock-kitchen",
    path: "Home & Garden > Kitchen, Dining & Bar > Small Kitchen Appliances",
    keywords: ["kitchen", "blender", "mixer", "toaster", "coffee", "maker", "appliance", "kettle", "processor"],
    aspects: [brand, { name: "Type", required: true }, { name: "Model" }, { name: "Color" }, { name: "Power Source", values: ["Electric", "Battery", "Manual"] }],
    conditions: GENERAL,
  },
  {
    id: "mock-cookware",
    path: "Home & Garden > Kitchen, Dining & Bar > Cookware",
    keywords: ["pan", "pot", "skillet", "cookware", "dutch", "oven", "cast", "iron", "pyrex", "dish", "bowl"],
    aspects: [brand, { name: "Type", required: true }, { name: "Material" }, { name: "Color" }],
    conditions: GENERAL,
  },
  {
    id: "mock-lamps",
    path: "Home & Garden > Lamps, Lighting & Ceiling Fans > Lamps",
    keywords: ["lamp", "lamps", "light", "lighting", "shade", "brass", "table", "desk", "floor"],
    aspects: [brand, { name: "Type", required: true, values: ["Table Lamp", "Desk Lamp", "Floor Lamp"], select: true }, { name: "Material" }, { name: "Style" }],
    conditions: GENERAL,
  },
  {
    id: "mock-decor",
    path: "Home & Garden > Home Décor > Other Home Décor",
    keywords: ["decor", "vase", "figurine", "frame", "mirror", "statue", "decorative", "ornament", "candle"],
    aspects: [brand, { name: "Type" }, { name: "Material" }, { name: "Color" }],
    conditions: GENERAL,
  },
  {
    id: "mock-records",
    path: "Music > Vinyl Records",
    keywords: ["vinyl", "record", "records", "lp", "album", "45", "rpm"],
    aspects: [{ name: "Artist", required: true }, { name: "Release Title", required: true }, { name: "Format", values: ["LP", "Single", "EP"] }, { name: "Genre" }, { name: "Record Label" }],
    conditions: MEDIA,
  },
  {
    id: "mock-tools",
    path: "Home & Garden > Tools & Workshop Equipment > Hand Tools",
    keywords: ["tool", "tools", "wrench", "hammer", "drill", "saw", "screwdriver", "pliers", "stanley", "craftsman"],
    aspects: [brand, { name: "Type", required: true }, { name: "Model" }],
    conditions: GENERAL,
  },
  {
    id: "mock-toys",
    path: "Toys & Hobbies > Action Figures & Accessories > Action Figures",
    keywords: ["toy", "toys", "figure", "action", "doll", "lego", "hasbro", "mattel", "kenner"],
    aspects: [brand, { name: "Character" }, { name: "Franchise" }, { name: "Year Manufactured" }],
    conditions: GENERAL,
  },
  {
    id: "mock-other",
    path: "Everything Else > Every Other Thing",
    keywords: [],
    aspects: [{ name: "Brand" }, { name: "Type" }],
    conditions: GENERAL,
  },
];

const CONDITION_NAMES: Record<string, string> = {
  "1000": "New",
  "1500": "New other (see details)",
  "2750": "Like New",
  "3000": "Used",
  "4000": "Very Good",
  "5000": "Good",
  "6000": "Acceptable",
  "7000": "For parts or not working",
};

const POLICIES = {
  payment: [{ paymentPolicyId: "mock-pay", name: "Test payment (immediate)" }],
  returns: [{ returnPolicyId: "mock-ret", name: "Test 30-day returns" }],
  shipping: [
    { fulfillmentPolicyId: "mock-ship-media", name: "Test Media Mail (books, comics, records)" },
    { fulfillmentPolicyId: "mock-ship-small", name: "Test small package" },
    { fulfillmentPolicyId: "mock-ship-large", name: "Test large package, calculated" },
  ],
};

const words = (s: string) => s.toLowerCase().match(/[a-z0-9-]+/g) ?? [];

export function mockSuggestions(q: string): MockCategory[] {
  const terms = new Set(words(q));
  const scored = MOCK_CATEGORIES.filter((c) => c.id !== "mock-other")
    .map((c) => ({ c, score: c.keywords.filter((k) => terms.has(k)).length + words(c.path).filter((w) => w.length > 3 && terms.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.c);
  return scored.length ? [...scored, MOCK_CATEGORIES.at(-1)!] : [MOCK_CATEGORIES.at(-1)!];
}

function byId(id: string | undefined | null) {
  return MOCK_CATEGORIES.find((c) => c.id === id);
}

// What the fake inventory remembers between calls, so publish can check the
// listing the way eBay does (required item specifics, allowed condition).
const items = new Map<string, { aspects: Record<string, string[]>; condition?: string }>();
const offers = new Map<string, { sku: string; categoryId: string }>();

const CONDITION_ENUM_TO_ID: Record<string, string> = {
  NEW: "1000",
  NEW_OTHER: "1500",
  LIKE_NEW: "2750",
  USED_EXCELLENT: "3000",
  USED_VERY_GOOD: "4000",
  USED_GOOD: "5000",
  USED_ACCEPTABLE: "6000",
  FOR_PARTS_OR_NOT_WORKING: "7000",
};

type Init = { method?: string; body?: unknown; query?: Record<string, string | undefined> };

function fail(status: number, errorId: number, message: string): never {
  throw new EbayError(status, [{ errorId, message: `${message} (test mode)` }], message);
}

/** Answers the eBay API paths the app uses, with test data. */
export async function mockEbay<T>(path: string, init: Init = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const q = init.query ?? {};
  const body = (init.body ?? {}) as Record<string, any>;
  const r = (v: unknown) => v as T;

  // Taxonomy
  if (path.endsWith("/get_default_category_tree_id")) return r({ categoryTreeId: "0", categoryTreeVersion: "mock-1" });
  if (path.endsWith("/get_category_suggestions")) {
    return r({
      categorySuggestions: mockSuggestions(q.q ?? "").map((c) => {
        const parts = c.path.split(" > ");
        return {
          category: { categoryId: c.id, categoryName: parts.at(-1) },
          // Like eBay: nearest parent first, level 1 = top of the tree.
          categoryTreeNodeAncestors: parts
            .slice(0, -1)
            .map((name, i) => ({ categoryName: name, categoryTreeNodeLevel: i + 1 }))
            .reverse(),
        };
      }),
    });
  }
  if (path.endsWith("/get_item_aspects_for_category")) {
    const c = byId(q.category_id) ?? fail(404, 62004, "Unknown test category");
    return r({
      aspects: c.aspects.map((a) => ({
        localizedAspectName: a.name,
        aspectConstraint: {
          aspectRequired: !!a.required,
          aspectUsage: "RECOMMENDED",
          aspectMode: a.select ? "SELECTION_ONLY" : "FREE_TEXT",
          itemToAspectCardinality: a.multi ? "MULTI" : "SINGLE",
        },
        aspectValues: (a.values ?? []).map((v) => ({ localizedValue: v })),
      })),
    });
  }

  // Metadata
  if (path.endsWith("/get_item_condition_policies")) {
    const id = /categoryIds:\{([^}]+)\}/.exec(q.filter ?? "")?.[1];
    const c = byId(id) ?? fail(404, 62004, "Unknown test category");
    return r({
      itemConditionPolicies: [
        {
          categoryId: c.id,
          itemConditionRequired: true,
          itemConditions: c.conditions.map((cid) => ({ conditionId: cid, conditionDescription: CONDITION_NAMES[cid] })),
        },
      ],
    });
  }

  // Browse: no comparable listings in test mode (price confidence shows as low)
  if (path === "/buy/browse/v1/item_summary/search") return r({ itemSummaries: [] });

  // Account
  if (path === "/sell/account/v1/payment_policy") return r(method === "POST" ? { paymentPolicyId: "mock-pay" } : { paymentPolicies: POLICIES.payment });
  if (path === "/sell/account/v1/return_policy") return r(method === "POST" ? { returnPolicyId: "mock-ret" } : { returnPolicies: POLICIES.returns });
  if (path === "/sell/account/v1/fulfillment_policy")
    return r(method === "POST" ? { fulfillmentPolicyId: "mock-ship-small" } : { fulfillmentPolicies: POLICIES.shipping });
  if (path === "/sell/account/v1/program/opt_in") return r({});
  if (path.startsWith("/sell/inventory/v1/location/")) return r(null);

  // Inventory
  const itemMatch = /^\/sell\/inventory\/v1\/inventory_item\/(.+)$/.exec(path);
  if (itemMatch && method === "PUT") {
    const sku = decodeURIComponent(itemMatch[1]);
    if (!body.product?.imageUrls?.length) fail(400, 25718, "At least one photo is required.");
    items.set(sku, { aspects: body.product?.aspects ?? {}, condition: body.condition });
    return r(null);
  }
  if (path === "/sell/inventory/v1/offer" && method === "POST") {
    const existing = [...offers.entries()].find(([, o]) => o.sku === body.sku);
    if (existing) fail(400, 25002, "Offer entity already exists.");
    const offerId = `mock-offer-${offers.size + 1}`;
    offers.set(offerId, { sku: body.sku, categoryId: body.categoryId });
    return r({ offerId });
  }
  if (path === "/sell/inventory/v1/offer" && method === "GET") {
    return r({ offers: [...offers.entries()].filter(([, o]) => o.sku === q.sku).map(([offerId]) => ({ offerId })) });
  }
  const offerMatch = /^\/sell\/inventory\/v1\/offer\/([^/]+)(\/publish)?$/.exec(path);
  if (offerMatch && method === "PUT") {
    const o = offers.get(offerMatch[1]) ?? fail(404, 25713, "Offer not found.");
    offers.set(offerMatch[1], { ...o, categoryId: body.categoryId ?? o.categoryId });
    return r(null);
  }
  if (offerMatch?.[2] && method === "POST") {
    const o = offers.get(offerMatch[1]) ?? fail(404, 25713, "Offer not found.");
    const item = items.get(o.sku) ?? fail(400, 25702, "Inventory item not found.");
    const c = byId(o.categoryId) ?? fail(400, 25005, "The category is not valid.");
    const missing = c.aspects.filter((a) => a.required && !item.aspects[a.name]?.length).map((a) => a.name);
    if (missing.length) fail(400, 25021, `Item specifics ${missing.join(", ")} are required for this category.`);
    const conditionId = item.condition ? CONDITION_ENUM_TO_ID[item.condition] : undefined;
    if (!conditionId || !c.conditions.includes(conditionId)) fail(400, 25021, "The item condition is not valid for this category.");
    return r({ listingId: `MOCK-${Date.now().toString().slice(-9)}` });
  }

  fail(501, 0, `Test mode doesn't handle ${method} ${path}`);
}
