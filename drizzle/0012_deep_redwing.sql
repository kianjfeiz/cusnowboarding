ALTER TABLE "trips" ALTER COLUMN "return_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "signup_phrase" text DEFAULT 'set a phrase' NOT NULL;