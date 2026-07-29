import Link from "next/link";
import { Badge, Card, Notice, formatDenver, formatMoney } from "@/components/ui";
import { Countdown } from "@/components/admin/countdown";
import { requireActor } from "./_lib/actor";
import {
  listPaymentsNeedingReview,
  listTrips,
  listUnpaidHolds,
  occupancyOf,
} from "./_lib/queries";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  await requireActor();

  const [trips, unpaidHolds, review] = await Promise.all([
    listTrips(),
    listUnpaidHolds(),
    listPaymentsNeedingReview(),
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

  const lapsedHolds = unpaidHolds.filter(
    (h) => new Date(h.payment_deadline_at).getTime() <= now,
  );
  const dueSoon = unpaidHolds.filter(
    (h) => new Date(h.payment_deadline_at).getTime() > now,
  );

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      {review.length > 0 ? (
        <Notice tone="alert" title="Payments against released spots">
          <p>
            {review.length} recorded payment{review.length === 1 ? "" : "s"} belong to a spot
            that has since been released or cancelled. The club is holding money against
            {review.length === 1 ? " a spot nobody has" : " spots nobody has"}. Reinstate the
            rider if the trip has room, or refund them.
          </p>
          <ul className="mt-2 space-y-1">
            {review.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/admin/trips/${p.trip_id}`}
                  className="text-accent underline underline-offset-4"
                >
                  {p.trip_title}
                </Link>{" "}
                - {p.email} - {formatMoney(p.amount_cents)}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {lapsedHolds.length > 0 ? (
        <Notice title={`${lapsedHolds.length} hold${lapsedHolds.length === 1 ? "" : "s"} lapsed`}>
          The payment deadline passed without payment. Release{" "}
          {lapsedHolds.length === 1 ? "it" : "them"} to free the spot, then promote from the
          waitlist.
          <ul className="mt-2 space-y-1">
            {lapsedHolds.slice(0, 8).map((h) => (
              <li key={h.signup_id}>
                <Link
                  href={`/admin/trips/${h.trip_id}`}
                  className="text-accent underline underline-offset-4"
                >
                  {h.trip_title}
                </Link>{" "}
                - {h.first_name} {h.last_name} - spot {h.spot_number ?? "-"}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {nextDrop ? (
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-faint">Next drop</p>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <Link
                href={`/admin/trips/${nextDrop.id}`}
                className="text-lg font-semibold hover:underline"
              >
                {nextDrop.title}
              </Link>
              <p className="mt-1 text-sm text-ink-muted">
                Opens {formatDenver(nextDrop.signup_opens_at)} · {nextDrop.capacity} spots ·{" "}
                {formatMoney(nextDrop.price_cents)}
              </p>
            </div>
            <Countdown targetMs={new Date(nextDrop.signup_opens_at).getTime()} />
          </div>
          {nextDrop.status !== "open" ? (
            <p className="mt-4 border-t border-border pt-4 text-xs text-ink-faint">
              Status is {nextDrop.status}. Signups will not open on their own unless the trip
              is set to open.
            </p>
          ) : null}
        </Card>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
          Trips
        </h2>
        {live.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-muted">
              No live trips.{" "}
              <Link href="/admin/trips/new" className="text-accent underline underline-offset-4">
                Create one
              </Link>
              .
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {live.map((trip) => {
              const { taken, free } = occupancyOf(trip);
              return (
                <Link
                  key={trip.id}
                  href={`/admin/trips/${trip.id}`}
                  className="block rounded-lg border border-border bg-paper p-4 transition-colors hover:border-border-strong"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{trip.title}</p>
                      <p className="mt-0.5 text-sm text-ink-muted">
                        {formatDenver(trip.depart_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge emphasis="strong">
                        {taken}/{trip.capacity} filled
                      </Badge>
                      {trip.held > 0 ? <Badge>{trip.held} unpaid</Badge> : null}
                      {trip.lapsed > 0 ? <Badge>{trip.lapsed} lapsed</Badge> : null}
                      {trip.waitlisted > 0 ? (
                        <Badge emphasis="muted">{trip.waitlisted} waitlisted</Badge>
                      ) : null}
                      {free > 0 && trip.waitlisted > 0 ? (
                        <Badge emphasis="strong">Promote</Badge>
                      ) : null}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {dueSoon.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
            Unpaid holds
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-paper">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Trip</th>
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Spot</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {dueSoon.map((hold) => (
                  <tr key={hold.signup_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/trips/${hold.trip_id}`}
                        className="hover:underline"
                      >
                        {hold.trip_title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {hold.first_name} {hold.last_name}
                      <div className="text-xs text-ink-faint">{hold.email}</div>
                    </td>
                    <td className="tnum px-4 py-3">{hold.spot_number ?? "-"}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {formatDenver(hold.payment_deadline_at)}
                    </td>
                    <td className="tnum px-4 py-3">{formatMoney(hold.amount_cents)}</td>
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
