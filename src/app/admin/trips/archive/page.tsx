import Link from "next/link";
import { Badge, formatDenver } from "@/components/ui";
import { EmptyRow, PageHeader, Section, TableWrap, Td, Th } from "@/components/admin/shell";
import { SubmitButton } from "@/components/admin/submit-button";
import { can } from "@/lib/authz";
import { requireActor } from "../../_lib/actor";
import { listArchivedTrips, occupancyOf } from "../../_lib/queries";
import { PHASE_LABELS, tripPhase } from "../../_lib/trip-status";
import { deleteTrip, restoreTrip } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Filed trips, and the only place a trip can be destroyed.
 *
 * Splitting the two apart is the point of the archive existing at all: the
 * action the board takes constantly is reversible and lives on the busy list,
 * and the one that cannot be undone sits on a page nobody visits by accident.
 */
export default async function TripArchivePage() {
  const actor = await requireActor();
  const trips = await listArchivedTrips();
  const mayManage = can(actor, "manageTrips");
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Archived trips"
        actions={
          <Link
            href="/admin/trips"
            className="inline-flex h-10 items-center rounded-md border border-border-strong px-3 text-xs font-medium hover:bg-surface sm:h-8"
          >
            Back to trips
          </Link>
        }
      />

      <Section title={`${trips.length} archived`}>
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <Th>Trip</Th>
                <Th>Signups</Th>
                <Th className="text-right">Filled</Th>
                <Th>Archived</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {trips.length === 0 ? (
                <EmptyRow colSpan={5}>Nothing archived.</EmptyRow>
              ) : (
                trips.map((trip) => {
                  const { taken } = occupancyOf(trip);
                  const phase = tripPhase(trip, now);

                  /*
                    Spelled out rather than summarised, because this is the last
                    moment anyone can read it. A board member deleting a trip
                    that ran should have to see the roster and payment counts
                    they are about to destroy.
                  */
                  const losses = [
                    trip.signups > 0
                      ? `${trip.signups} signup${trip.signups === 1 ? "" : "s"}`
                      : null,
                    trip.paid > 0 ? `${trip.paid} paid` : null,
                  ].filter(Boolean);

                  const confirm =
                    losses.length > 0
                      ? `Delete "${trip.title}" and its ${losses.join(" and ")}? The roster, payment records and photos go with it. This cannot be undone.`
                      : `Delete "${trip.title}"? This cannot be undone.`;

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
                          Departed {formatDenver(trip.depart_at)}
                          {trip.resort ? ` · ${trip.resort}` : ""}
                        </span>
                      </Td>

                      <Td>
                        <Badge>{PHASE_LABELS[phase]}</Badge>
                      </Td>

                      <Td className="whitespace-nowrap text-right">
                        <span className="tnum">
                          {taken}/{trip.capacity}
                        </span>
                      </Td>

                      <Td className="whitespace-nowrap text-ink-muted">
                        {trip.archived_at ? formatDenver(trip.archived_at) : "-"}
                      </Td>

                      <Td>
                        <div className="flex items-center justify-end gap-2">
                          {mayManage ? (
                            <>
                              <form action={restoreTrip}>
                                <input type="hidden" name="tripId" value={trip.id} />
                                <SubmitButton variant="secondary" pendingLabel="Restoring">
                                  Restore
                                </SubmitButton>
                              </form>
                              <form action={deleteTrip}>
                                <input type="hidden" name="tripId" value={trip.id} />
                                <SubmitButton
                                  variant="danger"
                                  pendingLabel="Deleting"
                                  confirm={confirm}
                                >
                                  Delete
                                </SubmitButton>
                              </form>
                            </>
                          ) : null}
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
