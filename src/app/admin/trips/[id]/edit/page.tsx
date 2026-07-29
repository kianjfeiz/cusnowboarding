import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/shell";
import { TripForm } from "@/components/admin/trip-form";
import { requireCapability } from "../../../_lib/actor";
import { toDenverInput } from "../../../_lib/datetime";
import { getTripSummary } from "../../../_lib/queries";
import { updateTrip } from "../../actions";

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
          signupClosesAt: toDenverInput(trip.signup_closes_at),
          priceDollars: (trip.price_cents / 100).toFixed(2),
          capacity: String(trip.capacity),
          waitlistCap: trip.waitlist_cap === null ? "" : String(trip.waitlist_cap),
          paymentWindowHours: String(trip.payment_window_hours),
          requiresDues: trip.requires_dues,
    paymentUrl: trip.payment_url ?? "",
        }}
      />
    </div>
  );
}
