ALTER TABLE "trips" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_archived_by_board_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."board_users"("id") ON DELETE no action ON UPDATE no action;