import Link from "next/link";
import { Badge, Button, formatDenver, formatMoney } from "@/components/ui";
import { EmptyRow, PageHeader, Section, TableWrap, Td, Th } from "@/components/admin/shell";
import { SubmitButton } from "@/components/admin/submit-button";
import { can } from "@/lib/authz";
import { requireActor } from "../_lib/actor";
import { listTrips, occupancyOf } from "../_lib/queries";
import {
  TRANSITION_LABELS,
  TRIP_STATUS_HINTS,
  TRIP_STATUS_LABELS,
  nextStatuses,
} from "../_lib/trip-status";
import { setTripStatus } from "./actions";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const actor = await requireActor();
  const trips = await listTrips();
  const mayManage = can(actor, "manageTrips");

  return (
    <>
      <PageHeader
        title="Trips"
        subtitle="Every trip, newest drop first."
        actions={
          mayManage ? (
            <Link href="/admin/trips/new">
              <Button>New trip</Button>
            </Link>
          ) : null
        }
      />

      <Section title={`${trips.length} trips`}>
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <Th>Trip</Th>
                <Th>Status</Th>
                <Th>Signups open</Th>
                <Th className="text-right">Filled</Th>
                <Th className="text-right">Waitlist</Th>
                <Th className="text-right">Price</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {trips.length === 0 ? (
                <EmptyRow colSpan={7}>No trips yet.</EmptyRow>
              ) : (
                trips.map((trip) => {
                  const { taken } = occupancyOf(trip);
                  return (
                    <tr key={trip.id} className="hover:bg-surface">
                      <Td>
                        <Link
                          href={`/admin/trips/${trip.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {trip.title}
                        </Link>
                        <span className="mt-0.5 block text-xs text-ink-faint">
                          /trips/{trip.slug}
                        </span>
                      </Td>
                      <Td>
                        <Badge emphasis={trip.status === "open" ? "strong" : "normal"}>
                          {TRIP_STATUS_LABELS[trip.status]}
                        </Badge>
                        <span className="mt-0.5 block text-xs text-ink-faint">
                          {TRIP_STATUS_HINTS[trip.status]}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap text-ink-muted">
                        {formatDenver(trip.signup_opens_at)}
                      </Td>
                      <Td className="tnum text-right">
                        {taken}/{trip.capacity}
                        {trip.lapsed > 0 ? (
                          <span className="ml-1 text-xs text-ink-faint">
                            ({trip.lapsed} lapsed)
                          </span>
                        ) : null}
                      </Td>
                      <Td className="tnum text-right text-ink-muted">{trip.waitlisted}</Td>
                      <Td className="tnum text-right text-ink-muted">
                        {formatMoney(trip.price_cents)}
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-2">
                          {mayManage
                            ? nextStatuses(trip.status)
                                .filter((target) => target !== "cancelled")
                                .map((target) => (
                                  <form key={target} action={setTripStatus}>
                                    <input type="hidden" name="tripId" value={trip.id} />
                                    <input type="hidden" name="status" value={target} />
                                    <SubmitButton variant="secondary">
                                      {TRANSITION_LABELS[target]}
                                    </SubmitButton>
                                  </form>
                                ))
                            : null}
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableWrap>
      </Section>
    </>
  );
}
