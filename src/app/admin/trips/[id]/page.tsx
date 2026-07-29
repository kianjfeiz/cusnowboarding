import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Notice, formatDenver, formatMoney } from "@/components/ui";
import { can } from "@/lib/authz";
import { requireActor } from "../../_lib/actor";
import {
  STATUS_LABELS,
  effectiveStatus,
  getRoster,
  getTripSummary,
  occupancyOf,
  type RosterRow,
} from "../../_lib/queries";
import {
  cancelSignup,
  promoteSignup,
  releaseSpot,
  releaseTripResults,
  setRosterFinalized,
} from "./actions";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";

export default async function TripRosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const trip = await getTripSummary(id);
  if (!trip) notFound();

  const roster = await getRoster(id);
  const { taken, free } = occupancyOf(trip);

  const now = Date.now();
  const onTrip = roster.filter((r) => ["paid", "held", "lapsed"].includes(effectiveStatus(r, now)));
  const waitlist = roster
    .filter((r) => r.status === "waitlisted")
    .sort((a, b) => a.claim_seq - b.claim_seq);
  const inactive = roster.filter((r) =>
    ["expired", "cancelled", "refunded"].includes(r.status),
  );

  const unpaidHolds = onTrip.filter((r) => effectiveStatus(r, now) === "held").length;
  const lapsed = onTrip.filter((r) => effectiveStatus(r, now) === "lapsed").length;
  const collected = roster
    .filter((r) => r.status === "paid")
    .reduce((sum, r) => sum + r.amount_cents, 0);

  const mayPromote = can(actor, "managePromotions");
  // Money recorded against a spot the member no longer holds. Derived rather
  // than flagged: nothing sets a flag now that payments are entered by hand.
  const needsReview = roster.filter(
    (r) => r.payment_status === "paid" && (r.status === "expired" || r.status === "cancelled"),
  );

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/admin/trips" className="text-sm text-ink-muted hover:text-ink">
              Trips
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{trip.title}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Departs {formatDenver(trip.depart_at)} · Signups opened{" "}
              {formatDenver(trip.signup_opens_at)}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/admin/trips/${trip.id}/drop-log`}
              className="inline-flex h-10 items-center rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-surface"
            >
              Drop log
            </Link>
            <a
              href={`/admin/trips/${trip.id}/roster.csv`}
              className="inline-flex h-10 items-center rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-surface"
            >
              Export CSV
            </a>
            {can(actor, "manageTrips") ? (
              <Link
                href={`/admin/trips/${trip.id}/edit`}
                className="inline-flex h-10 items-center rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-surface"
              >
                Edit
              </Link>
            ) : null}
          </div>
        </div>

        <p className="mt-4 text-sm text-ink">
          <span className="font-semibold">
            {taken}/{trip.capacity} filled
          </span>
          <span className="text-ink-muted">
            {" "}
            · {unpaidHolds} unpaid hold{unpaidHolds === 1 ? "" : "s"} · {waitlist.length}{" "}
            waitlisted · {formatMoney(collected)} collected
          </span>
        </p>
      </header>

      {mayPromote && !trip.results_released_at ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-medium">Results not sent yet</p>
              <p className="mt-1 text-sm text-ink-muted">
                Everyone who entered has been told only that their entry was
                received. Move people in and out of the list first, then send.
                Sending starts the {trip.payment_window_hours}-hour payment
                window for everyone holding a spot.
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/admin/trips/${trip.id}/roster-editor`}
                className="inline-flex h-8 items-center rounded-md border border-border-strong px-3 text-xs font-medium hover:bg-surface"
              >
                Edit list
              </Link>
              <form action={releaseTripResults}>
                <input type="hidden" name="tripId" value={trip.id} />
                <SubmitButton
                  variant="primary"
                  confirm={`Send results to everyone who entered? ${onTrip.length} will be told they are on the trip and ${waitlist.length} will be told they are waitlisted. This cannot be undone.`}
                >
                  Send results
                </SubmitButton>
              </form>
            </div>
          </div>
        </Card>
      ) : null}

      {mayPromote && trip.results_released_at ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-medium">
                {trip.roster_finalized_at ? "Roster is final" : "Roster is not final yet"}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {trip.roster_finalized_at
                  ? `Finalized ${formatDenver(trip.roster_finalized_at)}. Riders can see who is on the trip and share photos.`
                  : "Finalizing opens the attendee list and the photo pool to everyone who paid. Do it once holds have settled."}
              </p>
            </div>
            <form action={setRosterFinalized}>
              <input type="hidden" name="tripId" value={trip.id} />
              <input
                type="hidden"
                name="finalized"
                value={trip.roster_finalized_at ? "false" : "true"}
              />
              <SubmitButton
                variant={trip.roster_finalized_at ? "quiet" : "primary"}
                confirm={
                  trip.roster_finalized_at
                    ? "Unfinalize this roster? Riders will lose access to the attendee list and photos."
                    : `Finalize with ${unpaidHolds} unpaid hold${unpaidHolds === 1 ? "" : "s"} outstanding?`
                }
              >
                {trip.roster_finalized_at ? "Unfinalize" : "Finalize roster"}
              </SubmitButton>
            </form>
          </div>
        </Card>
      ) : null}

      {needsReview.length > 0 ? (
        <Notice tone="alert" title="Payment against a released spot">
          {needsReview.length} recorded payment{needsReview.length === 1 ? "" : "s"} belong to a
          spot that has since been released or cancelled. Reinstate the rider if there is room,
          or refund them.
        </Notice>
      ) : null}

      {free > 0 && trip.claim_counter >= trip.capacity ? (
        <Notice title={`${free} spot${free === 1 ? "" : "s"} cannot be claimed`}>
          Entries are numbered as they arrive, and this trip has already taken{" "}
          {trip.claim_counter}. A spot only goes to an entry numbered at or below
          the capacity, so {free === 1 ? "this spot" : "these spots"} can only be
          filled by moving someone over from the waitlist - raising capacity
          alone will not let anyone new claim {free === 1 ? "it" : "them"}.
        </Notice>
      ) : null}

      {lapsed > 0 ? (
        <Notice title={`${lapsed} hold${lapsed === 1 ? "" : "s"} lapsed`}>
          The payment deadline passed. Release {lapsed === 1 ? "it" : "them"} to free the
          spot, then promote from the waitlist.
        </Notice>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
          On the trip
        </h2>
        <RosterTable rows={onTrip} actor={{ mayPromote }} now={now} />
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
            Waitlist
          </h2>
          <p className="text-xs text-ink-faint">
            {free > 0
              ? `${free} spot${free === 1 ? "" : "s"} free - promote in order`
              : "No spot free"}
          </p>
        </div>

        {waitlist.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-muted">Nobody is waitlisted.</p>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-paper">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Claimed</th>
                  <th className="px-4 py-3 font-medium">Arrival</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {waitlist.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="tnum px-4 py-3 font-medium">{row.waitlist_position}</td>
                    <td className="px-4 py-3">
                      {row.first_name} {row.last_name}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{row.email}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {formatDenver(row.claimed_at)}
                    </td>
                    <td className="tnum px-4 py-3 text-ink-faint">#{row.claim_seq}</td>
                    <td className="px-4 py-3 text-right">
                      {mayPromote ? (
                        <form action={promoteSignup}>
                          <input type="hidden" name="signupId" value={row.id} />
                          {/*
                            Disabled is a courtesy only. promoteFromWaitlist takes
                            the trip row lock and re-checks that a spot is genuinely
                            free, so two coordinators clicking at once cannot both
                            be handed the same seat.
                          */}
                          <SubmitButton
                            disabled={free === 0}
                            title={free === 0 ? "No spot is free" : undefined}
                          >
                            Promote
                          </SubmitButton>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {inactive.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
            Released and cancelled
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-paper">
            <table className="w-full text-sm">
              <tbody>
                {inactive.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="tnum px-4 py-2.5 text-ink-faint">#{row.claim_seq}</td>
                    <td className="px-4 py-2.5">
                      {row.first_name} {row.last_name}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{row.email}</td>
                    <td className="px-4 py-2.5">
                      <Badge emphasis="muted">
                        {STATUS_LABELS[effectiveStatus(row, now)]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RosterTable({
  rows,
  actor,
  now,
}: {
  rows: RosterRow[];
  actor: { mayPromote: boolean };
  now: number;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">Nobody has claimed a spot yet.</p>
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-paper">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-faint">
          <tr>
            <th className="px-4 py-3 font-medium">Spot</th>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Contact</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Due</th>
            <th className="px-4 py-3 font-medium">Amount</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = effectiveStatus(row, now);
            return (
              <tr key={row.id} className="border-b border-border last:border-0 align-top">
                <td className="tnum px-4 py-3 font-medium">{row.spot_number ?? "-"}</td>
                <td className="px-4 py-3">
                  <div>
                    {row.first_name} {row.last_name}
                  </div>
                  {row.promoted_at ? (
                    <div className="mt-0.5 text-xs text-ink-faint">Promoted from waitlist</div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-ink-muted">
                  <div>{row.email}</div>
                  {row.phone ? <div className="text-xs">{row.phone}</div> : null}
                </td>
                <td className="px-4 py-3">
                  <Badge emphasis={status === "paid" ? "strong" : "normal"}>
                    {STATUS_LABELS[status]}
                  </Badge>
                  {row.paid_offline ? (
                    <div className="mt-1 text-xs text-ink-faint">
                      Offline{row.offline_note ? `: ${row.offline_note}` : ""}
                    </div>
                  ) : null}
                  {row.payment_status === "paid" &&
                  (row.status === "expired" || row.status === "cancelled") ? (
                    <div className="mt-1 text-xs text-alert">Paid, but spot released</div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-ink-muted">
                  {status === "paid"
                    ? row.paid_at
                      ? formatDenver(row.paid_at)
                      : "Paid"
                    : row.payment_deadline_at
                      ? formatDenver(row.payment_deadline_at)
                      : "-"}
                </td>
                <td className="tnum px-4 py-3">{formatMoney(row.amount_cents)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {actor.mayPromote && row.status === "held" ? (
                    <form action={releaseSpot} className="inline-block">
                      <input type="hidden" name="signupId" value={row.id} />
                      <input type="hidden" name="reason" value="board_release" />
                      <SubmitButton
                        variant="danger"
                        confirm={`Release ${row.first_name} ${row.last_name}'s spot? This frees it for the waitlist and cannot be undone from here.`}
                      >
                        Release
                      </SubmitButton>
                    </form>
                  ) : null}
                  {actor.mayPromote && ["held", "paid"].includes(row.status) ? (
                    <form action={cancelSignup} className="ml-2 inline-block">
                      <input type="hidden" name="signupId" value={row.id} />
                      <SubmitButton
                        variant="quiet"
                        confirm={`Cancel ${row.first_name} ${row.last_name}'s signup?${row.status === "paid" ? " They have already paid - you will need to refund them separately." : ""}`}
                      >
                        Cancel
                      </SubmitButton>
                    </form>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
