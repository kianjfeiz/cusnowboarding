import Link from "next/link";
import { auth } from "@/auth";
import { listUpcomingTrips } from "@/lib/trips/trips";
import { Badge, Card, DAY_ONLY, SectionHeading, formatDenver, formatMoney } from "@/components/ui";
import { CountdownChip } from "@/components/countdown-chip";
import { UpcomingList } from "@/components/calendar/upcoming-list";
import { UPCOMING_WEEKS, toCalendarItemViews } from "@/components/calendar/view";
import { listUpcomingCalendarItems } from "@/lib/events/events";
import { listMemberTrips, type MemberTrip } from "@/lib/trips/attendees";
import { standingOf, type Standing } from "@/lib/roster/standing";
import { DrawnTitle } from "@/components/drawn-title";
import { PaidLagNote, PayNowLink, STANDING_LABEL, dueLine } from "./signup-status";

export const dynamic = "force-dynamic";

const EVENT_LIMIT = 5;

/** A trip stays on Home through its departure day, then lives on My trips. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A scheduled trip opens itself when its clock arrives, so the time decides
 * whether signups are open, not the status alone.
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

  const [allTrips, calendarItems, memberTrips] = await Promise.all([
    listUpcomingTrips(),
    listUpcomingCalendarItems({ weeks: UPCOMING_WEEKS }),
    memberId ? listMemberTrips(memberId) : Promise.resolve([] as MemberTrip[]),
  ]);

  const upcoming = allTrips.filter((trip) => trip.departAt.getTime() > Date.now() - DAY_MS);

  // Trips already have their own section below; showing them again in the
  // calendar strip would list the same weekend twice.
  const events = toCalendarItemViews(calendarItems)
    .filter((item) => item.kind === "event")
    .slice(0, EVENT_LIMIT);

  // Where the member stands on each trip, so the list answers "am I going".
  const standings = new Map<string, Standing>(
    memberTrips.map((trip) => [trip.tripId, standingOf(trip)]),
  );

  // Lapsed holds are left out: the spot is gone, so the bill would chase a
  // member for something they can no longer buy. /me explains those.
  const due = memberTrips.filter((trip) => standingOf(trip) === "due");
  const totalDue = due.reduce((sum, trip) => sum + trip.amountCents, 0);

  // The hero is the soonest drop still ahead, or one live right now. The
  // lineup below never repeats it.
  const heroTrip =
    upcoming
      .filter((trip) => signupState(trip).live || trip.signupOpensAt.getTime() > Date.now())
      .sort((a, b) => a.signupOpensAt.getTime() - b.signupOpensAt.getTime())[0] ?? null;
  const lineup = upcoming.filter((trip) => trip.id !== heroTrip?.id);
  const heroState = heroTrip ? signupState(heroTrip) : null;
  const heroStanding = heroTrip ? standings.get(heroTrip.id) : undefined;

  return (
    <main className="mx-auto max-w-2xl px-5 pb-12 pt-6">
      <header className="mb-6">
        <DrawnTitle name="home">Home</DrawnTitle>
      </header>

      {due.length > 0 ? (
        <section className="mb-8 rounded-xl border border-accent/30 bg-accent-soft p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Payment due
            {due.length > 1 ? <span className="tnum"> · {formatMoney(totalDue)} total</span> : null}
          </p>
          <ul className="mt-3 space-y-3">
            {due.map((trip) => (
              <li
                key={trip.tripId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{trip.title}</p>
                  <p className="tnum text-sm text-ink-muted">{dueLine(trip)}</p>
                </div>
                <PayNowLink payToken={trip.payToken} />
              </li>
            ))}
          </ul>
          <PaidLagNote className="mt-4" />
        </section>
      ) : null}

      {heroTrip && heroState ? (
        <section className="mb-10">
          <Link
            href={`/trips/${heroTrip.slug}`}
            className="group block rounded-2xl border border-border bg-surface p-6 transition-colors hover:border-border-strong sm:p-8"
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {heroState.live ? (
                <>
                  <LiveDot />
                  Signups open
                </>
              ) : (
                "Next drop"
              )}
            </div>

            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              {heroTrip.title}
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              {formatDenver(heroTrip.departAt, DAY_ONLY)}
              {heroTrip.resort ? ` · ${heroTrip.resort}` : ""} ·{" "}
              {formatMoney(heroTrip.priceCents)} · {heroTrip.capacity} spots
            </p>

            <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
              {heroState.live ? null : (
                <div>
                  <p className="tnum text-4xl font-semibold tracking-tight sm:text-5xl">
                    <CountdownChip
                      targetMs={heroTrip.signupOpensAt.getTime()}
                      doneLabel="Open now"
                    />
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Opens {formatDenver(heroTrip.signupOpensAt)}
                  </p>
                </div>
              )}
              {heroStanding ? (
                <Badge emphasis="strong">{STANDING_LABEL[heroStanding]}</Badge>
              ) : (
                <span className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white transition-colors group-hover:bg-accent-hover">
                  {heroState.live ? "Sign up" : "Get ready"}
                  <span aria-hidden="true">&rarr;</span>
                </span>
              )}
            </div>
          </Link>
        </section>
      ) : null}

      <section>
        <SectionHeading className="mb-3">{heroTrip ? "More trips" : "Trips"}</SectionHeading>

        {lineup.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-muted">
              {upcoming.length === 0 ? "No trips posted yet." : "Nothing else scheduled yet."}
            </p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {lineup.map((trip) => {
              const signup = signupState(trip);
              const standing = standings.get(trip.id);
              return (
                <li key={trip.id}>
                  <Link
                    href={`/trips/${trip.slug}`}
                    className="group flex items-center gap-4 rounded-lg border border-border bg-paper p-5 transition-colors hover:border-border-strong"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">{trip.title}</p>
                      <p className="mt-0.5 text-sm text-ink-muted">
                        {formatDenver(trip.departAt, DAY_ONLY)}
                        {trip.resort ? ` · ${trip.resort}` : ""} · {formatMoney(trip.priceCents)}
                      </p>
                      {standing ? null : (
                        <p className="mt-2 flex items-center gap-2 text-sm">
                          {signup.live ? <LiveDot /> : null}
                          <span
                            className={signup.live ? "font-medium text-ink" : "text-ink-muted"}
                          >
                            {signup.label}
                          </span>
                        </p>
                      )}
                    </div>
                    {/* The member's own standing, in the words My trips uses. */}
                    {standing ? (
                      <Badge emphasis={standing === "due" ? "strong" : "normal"}>
                        {STANDING_LABEL[standing]}
                      </Badge>
                    ) : null}
                    <span
                      aria-hidden="true"
                      className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
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
          <SectionHeading>Upcoming events</SectionHeading>
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

/** The signup pulse: the one looping animation on the site, and it is state. */
function LiveDot() {
  return (
    <span aria-hidden="true" className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
    </span>
  );
}
