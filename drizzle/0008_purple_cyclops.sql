CREATE TABLE "member_dues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"term_year" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"provider" text DEFAULT 'fusion' NOT NULL,
	"reference" text,
	"note" text,
	"recorded_by" uuid,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_dues_amount_nonneg" CHECK ("member_dues"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "member_dues" ADD CONSTRAINT "member_dues_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_dues" ADD CONSTRAINT "member_dues_recorded_by_board_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."board_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_dues_one_per_season" ON "member_dues" USING btree ("member_id","term_year");--> statement-breakpoint
CREATE INDEX "member_dues_member_idx" ON "member_dues" USING btree ("member_id","term_year" DESC NULLS LAST);