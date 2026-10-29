CREATE TYPE "public"."item_status" AS ENUM('grouped', 'drafting', 'needs_review', 'approved', 'listed', 'sold', 'held', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "account_deletion_events" (
	"id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_cache" (
	"category_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_path" text NOT NULL,
	"tree_version" text NOT NULL,
	"aspects" jsonb NOT NULL,
	"conditions" jsonb NOT NULL,
	"condition_required" boolean DEFAULT true NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"version" integer NOT NULL,
	"source" text DEFAULT 'claude' NOT NULL,
	"category_id" text,
	"category_name" text,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"condition_id" text,
	"condition_notes" text,
	"aspects" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price" numeric(10, 2),
	"price_confidence" text,
	"comps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shipping_policy_id" text,
	"weight_oz" numeric(8, 2),
	"dims" jsonb,
	"quantity" integer DEFAULT 1 NOT NULL,
	"ai_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ebay_account" (
	"environment" text PRIMARY KEY NOT NULL,
	"refresh_token_enc" text,
	"refresh_token_expires" timestamp with time zone,
	"payment_policy_id" text,
	"return_policy_id" text,
	"default_shipping_policy_id" text,
	"location_key" text,
	"daily_listing_cap" integer DEFAULT 20 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"upload_id" text NOT NULL,
	"group_type" text,
	"status" "item_status" DEFAULT 'grouped' NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tested" text,
	"notes_to_ai" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"sku" text NOT NULL,
	"offer_id" text,
	"ebay_listing_id" text,
	"environment" text NOT NULL,
	"listed_at" timestamp with time zone,
	"list_price" numeric(10, 2),
	"sold_at" timestamp with time zone,
	"sold_price" numeric(10, 2),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"upload_id" text NOT NULL,
	"item_id" text,
	"original_key" text NOT NULL,
	"listing_key" text,
	"file_name" text NOT NULL,
	"width" integer,
	"height" integer,
	"taken_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"is_divider" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"photo_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_item_version_idx" ON "drafts" USING btree ("item_id","version");--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "photos_item_idx" ON "photos" USING btree ("item_id");