import { TripForm } from "@/components/admin/trip-form";
import { PageHeader } from "@/components/admin/shell";
import { requireCapability } from "../../_lib/actor";
import { toDenverInput } from "../../_lib/datetime";
import { createTrip } from "../actions";

export const dynamic = "force-dynamic";

/** Next Tuesday at 8pm Mountain, which is when the club has always dropped trips. */
function defaultDrop(): Date {
  const now = new Date();
  const days = (2 - now.getDay() + 7) % 7 || 7;
  const drop = new Date(now);
  drop.setDate(drop.getDate() + days);
  drop.setHours(20, 0, 0, 0);
  return drop;
}

export default async function NewTripPage() {
  await requireCapability("manageTrips");

  const drop = defaultDrop();
  const depart = new Date(drop.getTime() + 21 * 24 * 3_600_000);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New trip"
        subtitle="Saved as a draft. Nothing is visible to members until you publish."
        back={{ href: "/admin/trips", label: "Back to trips" }}
      />

      <TripForm
        action={createTrip}
        submitLabel="Create draft"
        cancelHref="/admin/trips"
        defaults={{
          title: "",
          slug: "",
          resort: "",
          description: "",
          departAt: toDenverInput(depart),
          returnAt: "",
          signupOpensAt: toDenverInput(drop),
          signupClosesAt: "",
          priceDollars: "85",
          capacity: "25",
          waitlistCap: "50",
          paymentWindowHours: "48",
          requiresDues: true,
    paymentUrl: "",
        }}
      />
    </div>
  );
}
