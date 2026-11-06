ALTER TABLE "items" ADD COLUMN "group_note" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "draft_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "thumb_key" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "divider_source" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "capture_source" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "pick_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "client_key" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "grouping_error" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "photos_upload_client_key_idx" ON "photos" USING btree ("upload_id","client_key");