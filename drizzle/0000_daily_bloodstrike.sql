CREATE TYPE "public"."payment_status" AS ENUM('open', 'paid', 'expired', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."signup_status" AS ENUM('held', 'paid', 'waitlisted', 'expired', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('draft', 'scheduled', 'open', 'closed', 'cancelled', 'completed');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_board_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_roles" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_user_roles" (
	"board_user_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"term_year" integer NOT NULL,
	CONSTRAINT "board_user_roles_board_user_id_role_key_term_year_pk" PRIMARY KEY("board_user_id","role_key","term_year")
);
--> statement-breakpoint
CREATE TABLE "board_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"name" text,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_superadmin" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "claim_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trip_id" uuid,
	"member_id" uuid,
	"email" "citext",
	"result" text NOT NULL,
	"claim_seq" bigint,
	"ip" "inet",
	"user_agent" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"email_verified_at" timestamp with time zone,
	"is_club_member" boolean DEFAULT false NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signup_id" uuid NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "payment_status" DEFAULT 'open' NOT NULL,
	"session_expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"claim_seq" bigint NOT NULL,
	"status" "signup_status" NOT NULL,
	"spot_number" integer,
	"waitlist_position" integer,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_deadline_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"promoted_at" timestamp with time zone,
	"promoted_by" uuid,
	"pay_token" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_offline" boolean DEFAULT false NOT NULL,
	"offline_note" text,
	"created_by_board_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signups_pay_token_unique" UNIQUE("pay_token"),
	CONSTRAINT "signups_state_shape" CHECK (
        ("signups"."status" in ('held','paid')
           and "signups"."spot_number" is not null
           and "signups"."waitlist_position" is null)
        or ("signups"."status" = 'waitlisted'
           and "signups"."spot_number" is null
           and "signups"."waitlist_position" is not null)
        or ("signups"."status" in ('expired','cancelled','refunded')
           and "signups"."spot_number" is null)
      ),
	CONSTRAINT "signups_held_has_deadline" CHECK ("signups"."status" <> 'held' or "signups"."payment_deadline_at" is not null),
	CONSTRAINT "signups_amount_nonneg" CHECK ("signups"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"resort" text,
	"depart_at" timestamp with time zone NOT NULL,
	"return_at" timestamp with time zone,
	"description" text,
	"price_cents" integer NOT NULL,
	"capacity" integer NOT NULL,
	"waitlist_cap" integer,
	"signup_opens_at" timestamp with time zone NOT NULL,
	"signup_closes_at" timestamp with time zone,
	"payment_window_hours" integer DEFAULT 48 NOT NULL,
	"requires_dues" boolean DEFAULT true NOT NULL,
	"status" "trip_status" DEFAULT 'draft' NOT NULL,
	"claim_counter" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_slug_unique" UNIQUE("slug"),
	CONSTRAINT "trips_price_nonneg" CHECK ("trips"."price_cents" >= 0),
	CONSTRAINT "trips_capacity_positive" CHECK ("trips"."capacity" > 0),
	CONSTRAINT "trips_waitlist_cap_positive" CHECK ("trips"."waitlist_cap" is null or "trips"."waitlist_cap" > 0),
	CONSTRAINT "trips_payment_window_sane" CHECK ("trips"."payment_window_hours" between 1 and 336)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_board_user_id_board_users_id_fk" FOREIGN KEY ("actor_board_user_id") REFERENCES "public"."board_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_user_roles" ADD CONSTRAINT "board_user_roles_board_user_id_board_users_id_fk" FOREIGN KEY ("board_user_id") REFERENCES "public"."board_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_user_roles" ADD CONSTRAINT "board_user_roles_role_key_board_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."board_roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_signup_id_signups_id_fk" FOREIGN KEY ("signup_id") REFERENCES "public"."signups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signups" ADD CONSTRAINT "signups_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signups" ADD CONSTRAINT "signups_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signups" ADD CONSTRAINT "signups_promoted_by_board_users_id_fk" FOREIGN KEY ("promoted_by") REFERENCES "public"."board_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signups" ADD CONSTRAINT "signups_created_by_board_user_id_board_users_id_fk" FOREIGN KEY ("created_by_board_user_id") REFERENCES "public"."board_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_created_by_board_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."board_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "board_user_roles_role_idx" ON "board_user_roles" USING btree ("role_key","term_year");--> statement-breakpoint
CREATE INDEX "claim_attempts_trip_idx" ON "claim_attempts" USING btree ("trip_id","created_at");--> statement-breakpoint
CREATE INDEX "email_verifications_lookup" ON "email_verifications" USING btree ("email","created_at" DESC NULLS LAST) WHERE consumed_at is null;--> statement-breakpoint
CREATE INDEX "members_verified_idx" ON "members" USING btree ("email_verified_at") WHERE email_verified_at is not null;--> statement-breakpoint
CREATE INDEX "payments_signup_idx" ON "payments" USING btree ("signup_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_open_idx" ON "payments" USING btree ("status") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "payments_review_idx" ON "payments" USING btree ("needs_review") WHERE needs_review;--> statement-breakpoint
CREATE UNIQUE INDEX "signups_one_active_per_member" ON "signups" USING btree ("trip_id","member_id") WHERE status in ('held','paid','waitlisted');--> statement-breakpoint
CREATE UNIQUE INDEX "signups_unique_spot" ON "signups" USING btree ("trip_id","spot_number") WHERE spot_number is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "signups_unique_seq" ON "signups" USING btree ("trip_id","claim_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "signups_unique_waitlist_pos" ON "signups" USING btree ("trip_id","waitlist_position") WHERE waitlist_position is not null and status = 'waitlisted';--> statement-breakpoint
CREATE INDEX "signups_trip_order_idx" ON "signups" USING btree ("trip_id","claim_seq");--> statement-breakpoint
CREATE INDEX "signups_trip_status_idx" ON "signups" USING btree ("trip_id","status");--> statement-breakpoint
CREATE INDEX "signups_expiry_idx" ON "signups" USING btree ("payment_deadline_at") WHERE status = 'held';--> statement-breakpoint
CREATE INDEX "signups_member_idx" ON "signups" USING btree ("member_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trips_open_idx" ON "trips" USING btree ("signup_opens_at") WHERE status in ('scheduled','open');