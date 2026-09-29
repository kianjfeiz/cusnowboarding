import Link from "next/link";
import { CountdownChip } from "@/components/countdown-chip";
import { Badge, Button, DAY_ONLY, Notice, formatDenver, formatMoney } from "@/components/ui";
import { PageHeader, Section } from "@/components/admin/shell";
import { can } from "@/lib/auth/authz";
import { requireActor } from "./_lib/actor";
import { getPaymentTotals } from "./_lib/payment-queries";
import {
  listPaymentsNeedingReview,
  listTrips,
  occupancyOf,
  type TripSummary,
} from "./_lib/queries";
import { PHASE_LABELS, tripPhase } from "./_lib/trip-status";

export const dynamic = "force-dynamic";

type NextStep = {
  /** What is happening, in a few words. */
  text: string;
  /**
   * Present only when there is somewhere useful to go. Quiet ones are routine
   * (money still coming in) and do not count as waiting on the board.
   */
  action?: {
    label: string;
    href: string;
    tone: "primary" | "secondary" | "quiet";
  };
};

/**
 * The one thing each trip is waiting on. A button appears only when the next
 * move is the board's, so a row without one needs nothing.
 */
function nextStep(trip: TripSummary, now: number): NextStep {
  const roster = `/admin/trips/${trip.id}`;
  const phase = tripPhase(trip, now);
  const { free } = occupancyOf(trip);

  switch (phase) {
    case "upcoming":
      return { text: `Opens ${formatDenver(trip.signup_opens_at)}` };
    case "live":
      return {
        text: trip.signup_closes_at
          ? `Taking entries until ${formatDenver(trip.signup_closes_at)}`
          : "Taking entries",
      };
    case "over":
    case "closed":
      return {
        text: "Nobody has been told yet",
        action: { label: "Review and release", href: roster, tone: "primary" },
      };
    case "sent":
      if (trip.lapsed > 0) {
        return {
          text: `${trip.lapsed} past the payment deadline`,
          action: { label: "Open roster", href: roster, tone: "secondary" },
        };
      }
      if (free > 0 && trip.waitlisted > 0) {
        return {
          text: `${free} spot${free === 1 ? "" : "s"} open, ${trip.waitlisted} waiting`,
          action: {
            label: `Fill ${free === 1 ? "spot" : "spots"}`,
            href: roster,
            tone: "secondary",
          },
        };
      }
      if (trip.held > 0) {
        return {
          text: `${trip.held} not marked paid`,
          action: {
            label: "See who owes",
            href: `/admin/payments?status=owing&trip=${trip.id}`,
            tone: "quiet",
          },
        };
      }
      return {
        text: trip.paid > 0 ? "Everyone has paid" : "Nobody on the trip yet",
      };
    default:
      return { text: "" };
  }
}

/**
 * Every trip that has not left yet, each with what it is waiting on, and the
 * money beside it. Anything else lives one click away on Trips or Payments.
 */
export default async function AdminDashboard() {
  const actor = await requireActor();

  const [trips, review, totals] = await Promise.all([
    listTrips(),
    listPaymentsNeedingReview(),
    getPaymentTotals(),
  ]);

  const now = Date.now();
  const upcoming = trips
    .filter((t) => ["scheduled", "open", "closed"].includes(t.status))
    .filter((t) => new Date(t.depart_at).getTime() > now)
    .sort((a, b) => new Date(a.depart_at).getTime() - new Date(b.depart_at).getTime())
    .map((trip) => ({ trip, next: nextStep(trip, now) }));

  const todo =
    upcoming.filter((row) => row.next.action && row.next.action.tone !== "quiet").length +
    (review.length > 0 ? 1 : 0);
  const unsettled = totals.unpaid_count + totals.lapsed_count;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          todo === 0
            ? "Nothing needs you right now."
            : `${todo} ${todo === 1 ? "thing needs" : "things need"} the board.`
        }
        actions={
          can(actor, "manageTrips") ? (
            <Link href="/admin/trips/new">
              <Button variant="secondary">New trip</Button>
            </Link>
          ) : null
        }
      />

      <div className="space-y-6">
        {review.length > 0 ? (
          <Notice tone="alert" title="Paid, but no longer on the trip">
            <ul className="space-y-1">
              {review.map((payment) => (
                <li key={payment.id}>
                  {payment.email}, {formatMoney(payment.amount_cents)} for {payment.trip_title}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              <Link
                href="/admin/payments?status=all"
                className="text-accent underline underline-offset-4"
              >
                Reinstate them from Payments
              </Link>{" "}
              if the trip has room, or refund them.
            </p>
          </Notice>
        ) : null}

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Section
            title="Upcoming trips"
            actions={
              <Link
                href="/admin/trips"
                className="text-xs font-medium text-ink-muted transition-colors hover:text-ink"
              >
                All trips
              </Link>
            }
          >
            {upcoming.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">No trips coming up.</p>
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map(({ trip, next }) => (
                  <TripRow key={trip.id} trip={trip} next={next} now={now} />
                ))}
              </ul>
            )}
          </Section>

          <Section title="Payments">
            <dl className="grid grid-cols-2 gap-4 px-5 py-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-faint">Owed</dt>
                <dd className="tnum mt-1 text-lg font-semibold text-ink">
                  {formatMoney(totals.outstanding_cents)}
                </dd>
                <dd className="text-xs text-ink-muted">{unsettled} not marked paid</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-faint">Collected</dt>
                <dd className="tnum mt-1 text-lg font-semibold text-ink">
                  {formatMoney(totals.collected_cents)}
                </dd>
                <dd className="text-xs text-ink-muted">{totals.paid_count} paid</dd>
              </div>
            </dl>
            <div className="px-5 pb-5">
              {/* The filter is stated rather than left to the payments page
                  default, so changing that default cannot silently repoint this. */}
              <Link href="/admin/payments?status=owing">
                <Button variant="secondary" className="w-full">
                  {unsettled === 0 ? "Open payments" : "See who owes"}
                </Button>
              </Link>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}

function TripRow({ trip, next, now }: { trip: TripSummary; next: NextStep; now: number }) {
  const phase = tripPhase(trip, now);
  const { taken } = occupancyOf(trip);
  const opensAt = new Date(trip.signup_opens_at).getTime();

  const counts =
    phase === "upcoming"
      ? `${trip.capacity} spots`
      : [
          `${taken} of ${trip.capacity} on the trip`,
          trip.waitlisted > 0 ? `${trip.waitlisted} waitlisted` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
      <div className="min-w-0">
        <Link
          href={`/admin/trips/${trip.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {trip.title}
        </Link>
        <p className="tnum mt-0.5 text-sm text-ink-muted">
          {formatDenver(trip.depart_at, DAY_ONLY)} · {counts}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink">
          <Badge
            emphasis={
              (next.action && next.action.tone !== "quiet") || phase === "live"
                ? "strong"
                : "normal"
            }
          >
            {PHASE_LABELS[phase]}
          </Badge>
          {next.text}
        </p>
      </div>

      {next.action ? (
        <Link href={next.action.href}>
          <Button variant={next.action.tone}>{next.action.label}</Button>
        </Link>
      ) : phase === "upcoming" ? (
        <span className="text-sm text-ink-muted">
          <CountdownChip targetMs={opensAt} doneLabel="Opening now" />
        </span>
      ) : null}
    </li>
  );
}
