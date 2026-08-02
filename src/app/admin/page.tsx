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

  // The next drop is the soonest signup window that has not opened yet.
  const nextDrop = live
    .filter((t) => new Date(t.signup_opens_at).getTime() > now)
    .sort(
      (a, b) =>
        new Date(a.signup_opens_at).getTime() - new Date(b.signup_opens_at).getTime(),
    )[0];

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
          <p className="text-xs uppercase tracking-wide text-ink-faint">Next drop</p>
          {nextDrop ? (
            <>
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
                <Link
                  href={`/admin/trips/${nextDrop.id}`}
                  className="text-lg font-semibold hover:underline"
                >
                  {nextDrop.title}
                </Link>
                <Countdown targetMs={new Date(nextDrop.signup_opens_at).getTime()} />
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                Opens {formatDenver(nextDrop.signup_opens_at)} · {nextDrop.capacity} spots ·{" "}
                {formatMoney(nextDrop.price_cents)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">
              Nothing scheduled.{" "}
              <Link href="/admin/trips/new" className="text-accent underline underline-offset-4">
                Create a trip
              </Link>
              .
            </p>
          )}
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
