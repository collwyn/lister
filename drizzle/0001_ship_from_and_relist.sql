ALTER TABLE "ebay_account" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "ebay_account" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "ebay_account" ADD COLUMN "state_or_province" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "relist_count" integer DEFAULT 0 NOT NULL;