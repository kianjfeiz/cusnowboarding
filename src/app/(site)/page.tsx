import Link from "next/link";
import type { CSSProperties } from "react";
import { auth } from "@/auth";
import { listUpcomingTrips } from "@/lib/trips";
import { Badge, Card, formatDenver, formatMoney } from "@/components/ui";
import { UpcomingList } from "@/components/calendar/upcoming-list";
import { toCalendarItemViews } from "@/components/calendar/view";
import { listUpcomingCalendarItems } from "@/lib/events";
import { listMemberTrips, type MemberTrip } from "@/lib/attendees";

export const dynamic = "force-dynamic";

/** Matches the calendar page, so "upcoming" means the same thing on both. */
const UPCOMING_WEEKS = 6;

/** Enough to be useful without turning the home page into the calendar. */
const EVENT_LIMIT = 5;

/** Rows past this point arrive together; only the top of a list is choreography. */
const STAGGER_LIMIT = 8;

const riseDelay = (index: number): CSSProperties =>
  ({ "--rise-delay": `${Math.min(index, STAGGER_LIMIT) * 45}ms` }) as CSSProperties;

/**
 * A scheduled trip opens itself the moment its clock arrives, so "scheduled"
 * no longer means "not yet claimable" - the time does. Reading the status alone
 * would tell a member signups open at 8pm while the button beside it is already
 * live. `live` drives the pulse dot: the one looping animation on the site,
 * and it is information - this is the state a member sprints for.
 */
function signupState(trip: {
  status: string;
  signupOpensAt: Date;
  signupClosesAt: Date | null;
}): { label: string; live: boolean } {
  if (trip.status === "closed") return { label: "Signups closed", live: false };

  const now = Date.now();
  if (trip.signupOpensAt.getTime() > now) {
    return { label: `Signups open ${formatDenver(trip.signupOpensAt)}`, live: false };
  }
  if (trip.signupClosesAt && trip.signupClosesAt.getTime() <= now) {
    return { label: "Signups closed", live: false };
  }
  return { label: "Signups open now", live: true };
}

export default async function Home() {
  const session = await auth();
  const memberId = session?.user?.memberId;

  const [upcoming, calendarItems, memberTrips] = await Promise.all([
    listUpcomingTrips(),
    listUpcomingCalendarItems({ weeks: UPCOMING_WEEKS }),
    memberId ? listMemberTrips(memberId) : Promise.resolve([] as MemberTrip[]),
  ]);

  // Trips already have their own section below; showing them again in the
  // calendar strip would list the same weekend twice.
  const events = toCalendarItemViews(calendarItems)
    .filter((item) => item.kind === "event")
    .slice(0, EVENT_LIMIT);

  // Lapsed holds are left out on purpose. The spot is already gone, so asking
  // for money on the home page would chase a member for something they can no
  // longer buy; /me and the trip page are where that gets explained. Same
  // no-grace reading of the deadline the member already sees on /me.
  const due = memberTrips.filter(
    (trip) =>
      trip.status === "held" &&
      trip.resultsReleased &&
      !(
        trip.paymentDeadlineAt !== null &&
        new Date(trip.paymentDeadlineAt).getTime() < Date.now()
      ),
  );
  const totalDue = due.reduce((sum, trip) => sum + trip.amountCents, 0);

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Trips, club events, and anything waiting on you.
        </p>
      </header>

      {due.length > 0 ? (
        /* The one thing on this page that is the member's to do, so it reads
           like a bill, not a bulletin: the amount is the headline and every
           line ends in the button that settles it. */
        <section className="mb-8 rounded-xl border border-accent/30 bg-accent-soft p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Waiting on you
          </p>
          <p className="tnum mt-1 text-2xl font-semibold tracking-tight">
            {formatMoney(totalDue)}
            <span className="ml-2 text-sm font-normal text-ink-muted">
              on {due.length} spot{due.length === 1 ? "" : "s"}
            </span>
          </p>
          <ul className="mt-4 space-y-3">
            {due.map((trip) => (
              <li
                key={trip.tripId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{trip.title}</p>
                  <p className="text-xs text-ink-muted">
                    <span className="tnum">{formatMoney(trip.amountCents)}</span> by{" "}
                    {trip.paymentDeadlineAt
                      ? formatDenver(trip.paymentDeadlineAt)
                      : "the deadline"}
                  </p>
                </div>
                <Link
                  href={`/pay/${trip.payToken}`}
                  className="inline-flex h-9 shrink-0 items-center rounded-md bg-accent px-4 text-sm font-medium text-white transition-[background-color,transform] duration-150 hover:bg-accent-hover active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
                >
                  Pay now
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
          Trips
        </h2>

        {upcoming.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-muted">No trips posted yet.</p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((trip, index) => {
              const signup = signupState(trip);
              return (
                <li key={trip.id} className="rise" style={riseDelay(index)}>
                  <Link
                    href={`/trips/${trip.slug}`}
                    className="group flex items-center gap-4 rounded-lg border border-border bg-paper p-5 transition-[border-color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-soft)] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-sm motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">{trip.title}</p>
                      <p className="mt-0.5 text-sm text-ink-muted">
                        {formatDenver(trip.departAt, {
                          hour: undefined,
                          minute: undefined,
                          timeZoneName: undefined,
                        })}
                        {trip.resort ? ` · ${trip.resort}` : ""}
                      </p>
                      <p className="mt-2 flex items-center gap-2 text-sm">
                        {signup.live ? (
                          <span aria-hidden="true" className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:animate-none" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                          </span>
                        ) : null}
                        <span className={signup.live ? "font-medium text-ink" : "text-ink-muted"}>
                          {signup.label}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <Badge emphasis="strong">{formatMoney(trip.priceCents)}</Badge>
                      <span className="text-xs text-ink-faint">{trip.capacity} spots</span>
                    </div>
                    <span
                      aria-hidden="true"
                      className="-translate-x-1 text-ink-faint opacity-0 transition-[transform,opacity] duration-200 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none"
                    >
                      &rarr;
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
            Upcoming events
          </h2>
          <Link
            href="/calendar"
            className="-my-2 py-2 text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
          >
            Full calendar
          </Link>
        </div>
        <UpcomingList items={events} />
      </section>
    </main>
  );
}
