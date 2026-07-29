ALTER TABLE "stripe_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "stripe_events" CASCADE;--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_stripe_checkout_session_id_unique";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_stripe_payment_intent_id_unique";--> statement-breakpoint
DROP INDEX "payments_open_idx";--> statement-breakpoint
DROP INDEX "payments_review_idx";--> statement-breakpoint
DROP INDEX "payments_one_open_per_signup";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'paid';--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "stripe_checkout_session_id";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "stripe_payment_intent_id";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "stripe_charge_id";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "session_expires_at";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "needs_review";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "raw";