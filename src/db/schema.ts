import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Listing Desk data model. See the build spec's "Data model" section.
// An item's status drives the workflow:
//   grouped -> drafting -> needs_review -> approved -> listed -> sold
//   (or held, rejected, failed)

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const itemStatus = pgEnum("item_status", [
  "grouped",
  "drafting",
  "needs_review",
  "approved",
  "listed",
  "sold",
  "held",
  "rejected",
  "failed",
]);
export type ItemStatus = (typeof itemStatus.enumValues)[number];

export const uploads = pgTable("uploads", {
  id: id(),
  createdAt: createdAt(),
  photoCount: integer("photo_count").notNull().default(0),
  status: text("status").notNull().default("open"),
});

export const items = pgTable(
  "items",
  {
    id: id(),
    uploadId: text("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    groupType: text("group_type"), // comics, books, magazines, electronics, household, other
    status: itemStatus("status").notNull().default("grouped"),
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
    tested: text("tested"), // electronics: works | not_working | untested
    notesToAi: text("notes_to_ai"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("items_status_idx").on(t.status)],
);

export const photos = pgTable(
  "photos",
  {
    id: id(),
    uploadId: text("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    itemId: text("item_id").references(() => items.id, { onDelete: "set null" }),
    originalKey: text("original_key").notNull(), // private bucket
    listingKey: text("listing_key"), // public bucket, resized JPEG
    fileName: text("file_name").notNull(),
    width: integer("width"),
    height: integer("height"),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    position: integer("position").notNull().default(0),
    isDivider: boolean("is_divider").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("photos_item_idx").on(t.itemId)],
);

export type Aspects = Record<string, string[]>;
export type Comp = { title: string; price: number; currency: string; condition?: string; url?: string };
export type Dims = { lengthIn: number; widthIn: number; heightIn: number };

export const drafts = pgTable(
  "drafts",
  {
    id: id(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    source: text("source").notNull().default("claude"), // claude | edit
    categoryId: text("category_id"),
    categoryName: text("category_name"),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    conditionId: text("condition_id"),
    conditionNotes: text("condition_notes"),
    aspects: jsonb("aspects").$type<Aspects>().notNull().default({}),
    price: numeric("price", { precision: 10, scale: 2 }),
    priceConfidence: text("price_confidence"),
    comps: jsonb("comps").$type<Comp[]>().notNull().default([]),
    shippingPolicyId: text("shipping_policy_id"),
    weightOz: numeric("weight_oz", { precision: 8, scale: 2 }),
    dims: jsonb("dims").$type<Dims | null>(),
    quantity: integer("quantity").notNull().default(1),
    aiNotes: text("ai_notes"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("drafts_item_version_idx").on(t.itemId, t.version)],
);

export type CachedAspect = {
  name: string;
  required: boolean;
  usage: "RECOMMENDED" | "OPTIONAL" | string;
  mode: "FREE_TEXT" | "SELECTION_ONLY" | string;
  multi: boolean;
  values: string[]; // allowed or suggested values, trimmed
};
export type CachedCondition = { conditionId: string; conditionDescription: string };

export const categoryCache = pgTable("category_cache", {
  categoryId: text("category_id").primaryKey(),
  name: text("name").notNull(),
  namePath: text("name_path").notNull(),
  treeVersion: text("tree_version").notNull(),
  aspects: jsonb("aspects").$type<CachedAspect[]>().notNull(),
  conditions: jsonb("conditions").$type<CachedCondition[]>().notNull(),
  conditionRequired: boolean("condition_required").notNull().default(true),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const listings = pgTable("listings", {
  id: id(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  sku: text("sku").notNull().unique(),
  offerId: text("offer_id"),
  ebayListingId: text("ebay_listing_id"),
  environment: text("environment").notNull(), // sandbox | production
  listedAt: timestamp("listed_at", { withTimezone: true }),
  listPrice: numeric("list_price", { precision: 10, scale: 2 }),
  soldAt: timestamp("sold_at", { withTimezone: true }),
  soldPrice: numeric("sold_price", { precision: 10, scale: 2 }),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// One row per eBay environment (sandbox / production) for now.
export const ebayAccount = pgTable("ebay_account", {
  environment: text("environment").primaryKey(),
  refreshTokenEnc: text("refresh_token_enc"), // AES-256-GCM, see src/lib/crypto.ts
  refreshTokenExpires: timestamp("refresh_token_expires", { withTimezone: true }),
  paymentPolicyId: text("payment_policy_id"),
  returnPolicyId: text("return_policy_id"),
  defaultShippingPolicyId: text("default_shipping_policy_id"),
  locationKey: text("location_key"),
  dailyListingCap: integer("daily_listing_cap").notNull().default(20),
  updatedAt: updatedAt(),
});

// Log of eBay Marketplace Account Deletion notifications (eBay requires the endpoint).
export const accountDeletionEvents = pgTable("account_deletion_events", {
  id: id(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").notNull(),
});

export const itemsRelations = relations(items, ({ many, one }) => ({
  upload: one(uploads, { fields: [items.uploadId], references: [uploads.id] }),
  photos: many(photos),
  drafts: many(drafts),
  listings: many(listings),
}));
export const photosRelations = relations(photos, ({ one }) => ({
  item: one(items, { fields: [photos.itemId], references: [items.id] }),
}));
export const draftsRelations = relations(drafts, ({ one }) => ({
  item: one(items, { fields: [drafts.itemId], references: [items.id] }),
}));
export const listingsRelations = relations(listings, ({ one }) => ({
  item: one(items, { fields: [listings.itemId], references: [items.id] }),
}));

export type Item = typeof items.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type EbayAccountRow = typeof ebayAccount.$inferSelect;
