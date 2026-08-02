CREATE TABLE "ride_riders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"driver_member_id" uuid NOT NULL,
	"seat_capacity" integer NOT NULL,
	"phone" text NOT NULL,
	"departs_note" text NOT NULL,
	"returns_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rides_seats_sane" CHECK ("rides"."seat_capacity" between 1 and 8)
);
--> statement-breakpoint
ALTER TABLE "ride_riders" ADD CONSTRAINT "ride_riders_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_riders" ADD CONSTRAINT "ride_riders_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_riders" ADD CONSTRAINT "ride_riders_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_member_id_members_id_fk" FOREIGN KEY ("driver_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ride_riders_one_seat_per_trip_idx" ON "ride_riders" USING btree ("trip_id","member_id");--> statement-breakpoint
CREATE INDEX "ride_riders_ride_idx" ON "ride_riders" USING btree ("ride_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rides_one_per_driver_idx" ON "rides" USING btree ("trip_id","driver_member_id");--> statement-breakpoint
CREATE INDEX "rides_trip_idx" ON "rides" USING btree ("trip_id","created_at");