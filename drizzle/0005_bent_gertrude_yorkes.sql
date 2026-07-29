ALTER TABLE "trips" ADD COLUMN "results_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "results_released_by" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_results_released_by_board_users_id_fk" FOREIGN KEY ("results_released_by") REFERENCES "public"."board_users"("id") ON DELETE no action ON UPDATE no action;