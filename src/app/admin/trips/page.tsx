import Link from "next/link";
import { Badge, Button, formatDenver } from "@/components/ui";
import { EmptyRow, PageHeader, Section, TableWrap, Td, Th } from "@/components/admin/shell";
import { SubmitButton } from "@/components/admin/submit-button";
import { can } from "@/lib/authz";
import { requireActor } from "../_lib/actor";
import { listArchivedTrips, listTrips, occupancyOf, type TripSummary } from "../_lib/queries";
import {
  PHASE_LABELS,
  transitionLabel,
  tripPhase,
  type TripPhase,
} from "../_lib/trip-status";
import { archiveTrip, setTripStatus } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The one status move worth putting on a list row. Everything else the board
 * does to a trip lives where the context is - the roster page or the edit form.
 */
function rowAction(
  trip: TripSummary,
  phase: TripPhase,
  now: number,
): { target: "scheduled" | "closed"; label: string } | null {
  if (phase === "draft") {
    return { target: "scheduled", label: transitionLabel("draft", "scheduled") };
  }
  if (phase === "live") {
    return { target: "closed", label: transitionLabel(trip.status, "closed") };
  }
  // Reopening only does something while the window is still running - the claim
  // statement checks signup_closes_at too, so after that it would be a button
  // that changes a word and nothing else.
  if (phase === "closed") {
    const closes = trip.signup_closes_at ? new Date(trip.signup_closes_at).getTime() : null;
    if (closes === null || closes > now) {
      return { target: "scheduled", label: transitionLabel("closed", "scheduled") };
    }
  }
  return null;
}

export default async function TripsPage() {
  const actor = await requireActor();
  const [trips, archived] = await Promise.all([listTrips(), listArchivedTrips()]);
  const mayManage = can(actor, "manageTrips");
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Trips"
        actions={
          <div className="flex items-center gap-2">
            {/* Only offered once something is in there - an empty archive is a
                link to an empty page. */}
            {archived.length > 0 ? (
              <Link
                href="/admin/trips/archive"
                className="inline-flex h-10 items-center rounded-md border border-border-strong px-3 text-xs font-medium hover:bg-surface sm:h-8"
              >
                Archive {archived.length}
              </Link>
            ) : null}
            {mayManage ? (
              <Link href="/admin/trips/new">
                <Button>New trip</Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <Section title={`${trips.length} trip${trips.length === 1 ? "" : "s"}`}>
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <Th>Trip</Th>
                <Th>Signups</Th>
                <Th className="text-right">Filled</Th>
                <Th>Results</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {trips.length === 0 ? (
                <EmptyRow colSpan={5}>No trips yet.</EmptyRow>
              ) : (
                trips.map((trip) => {
                  const { taken } = occupancyOf(trip);
                  const phase = tripPhase(trip, now);
                  const action = rowAction(trip, phase, now);
                  // Holds still running plus holds already past their deadline:
                  // both are spots the club is owed money for.
                  const unsettled = trip.held + trip.lapsed;

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
                          Departs {formatDenver(trip.depart_at)}
                          {trip.resort ? ` · ${trip.resort}` : ""}
                        </span>
                      </Td>

                      <Td>
                        <Badge emphasis={phase === "live" ? "strong" : "normal"}>
                          {PHASE_LABELS[phase]}
                        </Badge>
                        {/* Only the drop time earns a second line. Every other
                            phase's hint just said the badge again in a sentence. */}
                        {phase === "upcoming" ? (
                          <span className="mt-0.5 block whitespace-nowrap text-xs text-ink-faint">
                            Opens {formatDenver(trip.signup_opens_at)}
                          </span>
                        ) : null}
                      </Td>

                      <Td className="whitespace-nowrap text-right">
                        <span className="tnum">
                          {taken}/{trip.capacity}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-faint">
                          {trip.waitlisted > 0 ? `${trip.waitlisted} waitlisted` : "No waitlist"}
                          {trip.lapsed > 0 ? ` · ${trip.lapsed} lapsed` : ""}
                        </span>
                      </Td>

                      <Td className="whitespace-nowrap">
                        {trip.results_released_at ? (
                          <>
                            <span className="text-ink">Sent</span>
                            <span className="mt-0.5 block text-xs text-ink-faint">
                              {trip.roster_finalized_at ? "Roster final" : "Roster not final"}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-ink">Not sent</span>
                            <span className="mt-0.5 block text-xs text-ink-faint">
                              Entrants know nothing yet
                            </span>
                          </>
                        )}
                      </Td>

                      <Td>
                        <div className="flex items-center justify-end gap-2">
                          {mayManage && action ? (
                            <form action={setTripStatus}>
                              <input type="hidden" name="tripId" value={trip.id} />
                              <input type="hidden" name="status" value={action.target} />
                              <SubmitButton
                                variant={phase === "draft" ? "primary" : "secondary"}
                              >
                                {action.label}
                              </SubmitButton>
                            </form>
                          ) : null}
                          {mayManage ? (
                            <Link
                              href={`/admin/trips/${trip.id}/edit`}
                              className="inline-flex h-10 items-center rounded-md px-3 text-xs font-medium text-ink-muted hover:bg-surface hover:text-ink sm:h-8"
                            >
                              Edit
                            </Link>
                          ) : null}
                          {/* Archive, not delete. Nothing here is destructive
                              and the trip comes back in one click, so it is a
                              plain button - except when money is still owed.
                              Archiving takes the trip out of Payments, the
                              reminder cron and the member's own list, which
                              would quietly retire a debt nobody settled. */}
                          {mayManage ? (
                            <form action={archiveTrip}>
                              <input type="hidden" name="tripId" value={trip.id} />
                              <SubmitButton
                                variant="secondary"
                                pendingLabel="Archiving"
                                confirm={
                                  unsettled > 0
                                    ? `${unsettled} spot${unsettled === 1 ? "" : "s"} on "${trip.title}" ${unsettled === 1 ? "is" : "are"} still unpaid. Archiving hides the trip from Payments and stops its reminders. Archive anyway?`
                                    : undefined
                                }
                              >
                                Archive
                              </SubmitButton>
                            </form>
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
