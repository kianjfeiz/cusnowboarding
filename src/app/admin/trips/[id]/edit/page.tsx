import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/shell";
import { SubmitButton } from "@/components/admin/submit-button";
import { TripForm } from "@/components/admin/trip-form";
import { requireCapability } from "../../../_lib/actor";
import { toDenverInput } from "../../../_lib/datetime";
import { getTripSummary } from "../../../_lib/queries";
import { canTransition } from "../../../_lib/trip-status";
import { setTripStatus, updateTrip } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditTripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapability("manageTrips");

  const { id } = await params;
  const trip = await getTripSummary(id);
  if (!trip) notFound();

  const cancelled = trip.status === "cancelled";
  const mayCancel = canTransition(trip.status, "cancelled");
  const mayRestore = cancelled && canTransition(trip.status, "scheduled");

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={`Edit ${trip.title}`}
        subtitle="Price changes do not alter what existing signups owe - that amount is snapshotted at claim time."
        back={{ href: `/admin/trips/${trip.id}`, label: "Back to roster" }}
      />

      <TripForm
        action={updateTrip}
        submitLabel="Save changes"
        cancelHref={`/admin/trips/${trip.id}`}
        defaults={{
          id: trip.id,
          title: trip.title,
          slug: trip.slug,
          resort: trip.resort ?? "",
          description: trip.description ?? "",
          departAt: toDenverInput(trip.depart_at),
          returnAt: toDenverInput(trip.return_at),
          signupOpensAt: toDenverInput(trip.signup_opens_at),
          signupPhrase: trip.signup_phrase,
          priceDollars: (trip.price_cents / 100).toFixed(2),
          capacity: String(trip.capacity),
          waitlistCap: trip.waitlist_cap === null ? "" : String(trip.waitlist_cap),
          paymentWindowHours: String(trip.payment_window_hours),
          requiresDues: trip.requires_dues,
          paymentUrl: trip.payment_url ?? "",
        }}
      />

      {mayCancel || mayRestore ? (
        <section className="mt-8 rounded-lg border border-border bg-paper p-6">
          <h2 className="text-sm font-semibold text-ink">
            {cancelled ? "This trip is cancelled" : "Calling it off"}
          </h2>
          <p className="mt-1 mb-4 text-sm text-ink-muted">
            {cancelled
              ? "Members cannot see it and nobody can claim. Restoring puts it back on the schedule with its signups and roster untouched."
              : "Cancelling hides the trip from members and stops all claims. It does not refund or notify anyone who already paid - tell them yourself."}
          </p>
          <form action={setTripStatus}>
            <input type="hidden" name="tripId" value={trip.id} />
            <input type="hidden" name="status" value={cancelled ? "scheduled" : "cancelled"} />
            <SubmitButton
              variant={cancelled ? "secondary" : "danger"}
              confirm={
                cancelled
                  ? undefined
                  : `Cancel ${trip.title}? Members will no longer see it and nobody can claim a spot.`
              }
            >
              {cancelled ? "Restore trip" : "Cancel trip"}
            </SubmitButton>
          </form>
        </section>
      ) : null}
    </div>
  );
}
