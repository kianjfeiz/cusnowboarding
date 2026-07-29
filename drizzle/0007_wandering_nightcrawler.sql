ALTER TABLE "payments" ALTER COLUMN "provider" SET DEFAULT 'fusion';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "payment_url" text;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_board_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."board_users"("id") ON DELETE no action ON UPDATE no action;