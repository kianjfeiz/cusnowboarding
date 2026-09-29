ALTER TABLE "trip_photos" ALTER COLUMN "trip_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_photos" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_photos_event_idx" ON "trip_photos" USING btree ("event_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_one_subject" CHECK (num_nonnulls("trip_photos"."trip_id", "trip_photos"."event_id") = 1);