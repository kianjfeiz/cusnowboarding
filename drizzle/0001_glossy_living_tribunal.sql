CREATE TYPE "public"."photo_status" AS ENUM('processing', 'ready', 'removed');--> statement-breakpoint
CREATE TABLE "trip_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"uploader_member_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"original_filename" text,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"caption" text,
	"taken_at" timestamp with time zone,
	"status" "photo_status" DEFAULT 'processing' NOT NULL,
	"removed_by_board_user_id" uuid,
	"removed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_photos_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "trip_photos_size_positive" CHECK ("trip_photos"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "google_sub" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_uploader_member_id_members_id_fk" FOREIGN KEY ("uploader_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_removed_by_board_user_id_board_users_id_fk" FOREIGN KEY ("removed_by_board_user_id") REFERENCES "public"."board_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_photos_trip_idx" ON "trip_photos" USING btree ("trip_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trip_photos_uploader_idx" ON "trip_photos" USING btree ("uploader_member_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trip_photos_visible_idx" ON "trip_photos" USING btree ("trip_id","taken_at" DESC NULLS LAST) WHERE status = 'ready';--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_google_sub_unique" UNIQUE("google_sub");