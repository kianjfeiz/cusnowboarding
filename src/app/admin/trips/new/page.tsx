import { formatInTimeZone } from "date-fns-tz";
import { TripForm } from "@/components/admin/trip-form";
import { PageHeader } from "@/components/admin/shell";
import { requireCapability } from "../../_lib/actor";
import { DENVER } from "../../_lib/datetime";
import { createTrip } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Today's date in Denver, carried as a UTC midnight so that adding days below
 * is plain calendar arithmetic. Doing this with the server's local clock puts
 * the default drop at 1pm Mountain when the server is in UTC, which is where it
 * actually runs.
 */
function denverToday(): Date {
  const [year, month, day] = formatInTimeZone(new Date(), DENVER, "yyyy-MM-dd")
    .split("-")
    .map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function inputValue(day: Date, time: string): string {
  return `${day.toISOString().slice(0, 10)}T${time}`;
}

export default async function NewTripPage() {
  await requireCapability("manageTrips");

  // The club has always dropped at 8pm on a Tuesday, and the trip is the
  // Saturday after next - eleven days on from a Tuesday.
  const drop = denverToday();
  drop.setUTCDate(drop.getUTCDate() + ((2 - drop.getUTCDay() + 7) % 7 || 7));
  const depart = new Date(drop);
  depart.setUTCDate(depart.getUTCDate() + 11);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New trip"
        back={{ href: "/admin/trips", label: "Trips" }}
      />

      <TripForm
        action={createTrip}
        submitLabel="Create trip"
        cancelHref="/admin/trips"
        defaults={{
          title: "",
          resort: "",
          description: "",
          departAt: inputValue(depart, "06:00"),
          // Same day, evening: the club runs day trips far more often than
          // overnights, so this is the value that is usually already right.
          returnAt: inputValue(depart, "18:00"),
          signupOpensAt: inputValue(drop, "20:00"),
          signupPhrase: "",
          priceDollars: "85",
          capacity: "25",
          waitlistCap: "",
          paymentWindowHours: "48",
          requiresDues: true,
          paymentUrl: "",
        }}
      />
    </div>
  );
}
