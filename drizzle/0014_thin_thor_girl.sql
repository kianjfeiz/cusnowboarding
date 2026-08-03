ALTER TABLE "signups" DROP CONSTRAINT "signups_state_shape";--> statement-breakpoint
ALTER TABLE "signups" ADD COLUMN "board_seat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signups" ADD CONSTRAINT "signups_board_seat_free" CHECK (not "signups"."board_seat" or "signups"."amount_cents" = 0);--> statement-breakpoint
ALTER TABLE "signups" ADD CONSTRAINT "signups_state_shape" CHECK (
        ("signups"."status" in ('held','paid')
           and "signups"."spot_number" is not null
           and "signups"."waitlist_position" is null)
        or ("signups"."status" = 'paid' and "signups"."board_seat"
           and "signups"."spot_number" is null
           and "signups"."waitlist_position" is null)
        or ("signups"."status" = 'waitlisted'
           and "signups"."spot_number" is null
           and "signups"."waitlist_position" is not null)
        or ("signups"."status" in ('expired','cancelled','refunded')
           and "signups"."spot_number" is null)
      );