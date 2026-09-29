import Link from "next/link";
import { Badge, Button, formatDenver } from "@/components/ui";
import { EmptyRow, PageHeader, Section, TableWrap, Td, Th } from "@/components/admin/shell";
import { SubmitButton } from "@/components/admin/submit-button";
import { can } from "@/lib/auth/authz";
import { requireActor } from "../_lib/actor";
import { listTrips, occupancyOf, type TripSummary } from "../_lib/queries";
import {
  PHASE_LABELS,
  transitionLabel,
  tripPhase,
  type TripPhase,
} from "../_lib/trip-status";
import { deleteTrip, setTripStatus } from "./actions";

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
  // Closing early is still worth a button: the board sometimes wants entries to
  // stop before it is ready to publish anything. Releasing the roster closes
  // signups on its own, so this is a shortcut rather than a step.
  if (phase === "live") {
    return { target: "closed", label: transitionLabel(trip.status, "closed") };
  }
  // Reopening only does something while the window is still running - the claim
  // statement checks signup_closes_at too, so after that it would be a button
  // that changes a word and nothing else. A released trip is never in this
  // phase, which is what keeps entries off a roster everybody has been shown.
  if (phase === "closed") {
    const closes = trip.signup_closes_at ? new Date(trip.signup_closes_at).getTime() : null;
    if (closes === null || closes > now) {
      return { target: "scheduled", label: transitionLabel("closed", "scheduled") };
    }
  }
  return null;
}

function stageDetail(trip: TripSummary, phase: TripPhase): string | null {
  if (phase === "upcoming") return `Opens ${formatDenver(trip.signup_opens_at)}`;
  if (phase === "over" || phase === "closed") return "Roster not released";
  if (phase === "sent") {
    // Holds still running plus holds already past their deadline: both are
    // spots the club is owed money for.
    const unsettled = trip.held + trip.lapsed;
    return unsettled > 0 ? `${unsettled} unpaid` : trip.paid > 0 ? "All paid" : "Nobody paid yet";
  }
  return null;
}

/**
 * Spelled out rather than summarised. A board member deleting a trip that ran
 * should have to see the roster and payment counts they are about to destroy,
 * and money still owed is retired with the trip rather than collected.
 */
function deleteConfirmation(trip: TripSummary): string {
  const unsettled = trip.held + trip.lapsed;
  const losses = [
    trip.signups > 0 ? `${trip.signups} signup${trip.signups === 1 ? "" : "s"}` : null,
    trip.paid > 0 ? `${trip.paid} paid` : null,
    unsettled > 0 ? `${unsettled} still unpaid` : null,
  ].filter(Boolean);

  return losses.length > 0
    ? `Delete "${trip.title}"? It has ${losses.join(", ")}. The roster, payment records and photos go with it. This cannot be undone.`
    : `Delete "${trip.title}"? This cannot be undone.`;
}

export default async function TripsPage() {
  const actor = await requireActor();
  const trips = await listTrips();
  const mayManage = can(actor, "manageTrips");
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Trips"
        actions={
          mayManage ? (
            <Link href="/admin/trips/new">
              <Button>New trip</Button>
            </Link>
          ) : null
        }
      />

      <Section title={`${trips.length} trip${trips.length === 1 ? "" : "s"}`}>
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <Th>Trip</Th>
                <Th>Stage</Th>
                <Th className="text-right">Filled</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {trips.length === 0 ? (
                <EmptyRow colSpan={4}>No trips yet.</EmptyRow>
              ) : (
                trips.map((trip) => {
                  const { taken } = occupancyOf(trip);
                  const phase = tripPhase(trip, now);
                  const action = rowAction(trip, phase, now);
                  const detail = stageDetail(trip, phase);

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
                        {/* One line under the stage, only where it says what
                            comes next: when the drop is, that the roster is
                            waiting, or how much money is still out. */}
                        {detail ? (
                          <span className="mt-0.5 block whitespace-nowrap text-xs text-ink-faint">
                            {detail}
                          </span>
                        ) : null}
                      </Td>

                      <Td className="whitespace-nowrap text-right">
                        <span className="tnum">
                          {taken}/{trip.capacity}
                        </span>
                        {trip.waitlisted > 0 || trip.lapsed > 0 ? (
                          <span className="mt-0.5 block text-xs text-ink-faint">
                            {[
                              trip.waitlisted > 0 ? `${trip.waitlisted} waitlisted` : null,
                              trip.lapsed > 0 ? `${trip.lapsed} lapsed` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ) : null}
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
                          {/* The only destructive control on this list, so it
                              always asks, and the question names what goes
                              with the trip - this is the last moment anyone
                              can read those counts. */}
                          {mayManage ? (
                            <form action={deleteTrip}>
                              <input type="hidden" name="tripId" value={trip.id} />
                              <SubmitButton
                                variant="danger"
                                pendingLabel="Deleting"
                                confirm={deleteConfirmation(trip)}
                              >
                                Delete trip
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
