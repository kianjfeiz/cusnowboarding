import Link from "next/link";
import { Card, Notice, formatDenver, formatMoney } from "@/components/ui";
import { Countdown } from "@/components/admin/countdown";
import { HOLD_GRACE_MINUTES } from "@/lib/holds";
import { requireActor } from "./_lib/actor";
import { getPaymentTotals, outstandingCents } from "./_lib/payment-queries";

import {
  listPaymentsNeedingReview,
  listTrips,
  listUnpaidHolds,
  occupancyOf,
} from "./_lib/queries";

export const dynamic = "force-dynamic";

/** Enough to see the season coming without the dashboard becoming the trip list. */
const DASHBOARD_TRIPS = 3;

/**
 * One screen answering "what needs a board member today". Everything that is
 * merely interesting - the trip list, per-trip counts, the full unpaid table -
 * lives one click away on Trips or Payments and is deliberately not repeated
 * here, because a dashboard that shows everything shows nothing.
 */
export default async function AdminDashboard() {
  await requireActor();

  const [trips, unpaidHolds, review, totals] = await Promise.all([
    listTrips(),
    listUnpaidHolds(),
    listPaymentsNeedingReview(),
    getPaymentTotals(),
  ]);

  const now = Date.now();
  const live = trips.filter((t) => ["scheduled", "open", "closed"].includes(t.status));

  /*
    Ordered by when the trip actually happens, not by when its signups opened.

    The old version listed only trips whose drop was still in the future, which
    meant the panel emptied out the moment the last drop opened - the board lost
    sight of the trips precisely while they were running. A trip belongs here
    until it departs, whatever its signup window has done.
  */
  const upcoming = live
    .filter((t) => new Date(t.depart_at).getTime() > now)
    .sort((a, b) => new Date(a.depart_at).getTime() - new Date(b.depart_at).getTime());

  // Same grace the reaper and the trip pages use, so a hold is called lapsed
  // here only once its spot is genuinely reclaimable. Without it this screen
  // would report one more lapsed hold than the trip it links to.
  const lapsedCutoff = now - HOLD_GRACE_MINUTES * 60_000;
  const lapsed = unpaidHolds.filter(
    (h) => new Date(h.payment_deadline_at).getTime() <= lapsedCutoff,
  );

  const promotable = live
    .map((trip) => ({ trip, ...occupancyOf(trip) }))
    .filter((row) => row.free > 0 && row.trip.waitlisted > 0);

  const outstanding = outstandingCents(totals);
  const unsettled = totals.unpaid_count + totals.lapsed_count;
  const clear = lapsed.length === 0 && promotable.length === 0 && review.length === 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-faint">Upcoming trips</p>
          {upcoming.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              Nothing scheduled.{" "}
              <Link href="/admin/trips/new" className="text-accent underline underline-offset-4">
                Create a trip
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {upcoming.slice(0, DASHBOARD_TRIPS).map((trip) => {
                const opensAt = new Date(trip.signup_opens_at).getTime();
                const { taken, free } = occupancyOf(trip);

                return (
                  <li key={trip.id} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Link
                        href={`/admin/trips/${trip.id}`}
                        className="font-medium hover:underline"
                      >
                        {trip.title}
                      </Link>
                      {/* The countdown is only news before the drop; afterwards
                          what the board wants is how full the trip is. */}
                      {opensAt > now ? (
                        <Countdown targetMs={opensAt} />
                      ) : (
                        <span className="tnum text-sm text-ink-muted">
                          {taken}/{trip.capacity}
                          {free === 0 ? " full" : ""}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {formatDenver(trip.depart_at, {
                        hour: undefined,
                        minute: undefined,
                        timeZoneName: undefined,
                      })}
                      {opensAt > now ? ` · Opens ${formatDenver(trip.signup_opens_at)}` : ""}
                      {" · "}
                      {formatMoney(trip.price_cents)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          {upcoming.length > DASHBOARD_TRIPS ? (
            <Link
              href="/admin/trips"
              className="mt-3 inline-flex h-10 items-center rounded-md border border-border-strong px-3 text-xs font-medium hover:bg-surface sm:h-8"
            >
              All {upcoming.length} trips
            </Link>
          ) : null}
        </Card>

        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-faint">Outstanding</p>
          <p className="tnum mt-2 text-lg font-semibold">{formatMoney(outstanding)}</p>
          <p className="mt-1 text-sm text-ink-muted">
            {unsettled === 0
              ? "Every spot on a live trip is settled."
              : `${unsettled} spot${unsettled === 1 ? "" : "s"} unsettled.`}
          </p>
          {/* Named by the list rather than the action: a treasurer looking at a
              balance wants to know who it is before deciding to record
              anything, and recording happens on that page regardless. The
              filter is stated rather than left to the payments page default, so
              changing that default cannot silently repoint this. */}
          <Link
            href="/admin/payments?status=owing"
            className="mt-3 inline-flex h-10 items-center rounded-md border border-border-strong px-3 text-xs font-medium hover:bg-surface sm:h-8"
          >
            {unsettled === 0 ? "Open payments" : "See who owes"}
          </Link>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
          Needs attention
        </h2>

        {clear ? (
          <Card>
            <p className="text-sm text-ink-muted">Nothing to act on right now.</p>
          </Card>
        ) : null}

        {lapsed.length > 0 ? (
          <Notice title={`${lapsed.length} hold${lapsed.length === 1 ? "" : "s"} lapsed`}>
            The payment deadline passed without payment. Release{" "}
            {lapsed.length === 1 ? "it" : "them"} to free the spot, then promote from the
            waitlist.
            <ul className="mt-2 space-y-1">
              {lapsed.slice(0, 8).map((hold) => (
                <li key={hold.signup_id}>
                  <Link
                    href={`/admin/trips/${hold.trip_id}`}
                    className="text-accent underline underline-offset-4"
                  >
                    {hold.trip_title}
                  </Link>{" "}
                  - {hold.first_name} {hold.last_name} - spot {hold.spot_number ?? "-"}
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {promotable.length > 0 ? (
          <Notice title="Free spots with people waiting">
            <ul className="space-y-1">
              {promotable.map(({ trip, free }) => (
                <li key={trip.id}>
                  <Link
                    href={`/admin/trips/${trip.id}`}
                    className="text-accent underline underline-offset-4"
                  >
                    {trip.title}
                  </Link>{" "}
                  - {free} free, {trip.waitlisted} waitlisted
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {review.length > 0 ? (
          <Notice tone="alert" title="Money held against a spot nobody has">
            <p>
              {review.length} recorded payment{review.length === 1 ? "" : "s"} belong to a
              spot that has since been released or cancelled. Reinstate the rider if the
              trip has room, or refund them.
            </p>
            <ul className="mt-2 space-y-1">
              {review.map((payment) => (
                <li key={payment.id}>
                  <Link
                    href={`/admin/trips/${payment.trip_id}`}
                    className="text-accent underline underline-offset-4"
                  >
                    {payment.trip_title}
                  </Link>{" "}
                  - {payment.email} - {formatMoney(payment.amount_cents)}
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}
      </section>
    </div>
  );
}
