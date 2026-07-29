ALTER TABLE "trips" ADD COLUMN "roster_finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "roster_finalized_by" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_roster_finalized_by_board_users_id_fk" FOREIGN KEY ("roster_finalized_by") REFERENCES "public"."board_users"("id") ON DELETE no action ON UPDATE no action;