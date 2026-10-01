import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { Badge, Card, DAY_ONLY, SectionHeading, formatDenver } from "@/components/ui";
import { listMemberTrips, type MemberTrip } from "@/lib/trips/attendees";
import { standingOf, type Standing } from "@/lib/roster/standing";
import { DrawnTitle } from "@/components/drawn-title";
import { STANDING_LABEL, StandingNotice } from "../signup-status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My trips - CU Snowboarding" };

/**
 * Only trips the member is actually on: a board seat, or a spot once the roster
 * is out, paid or not yet. An entry before release, the waitlist and anyone
 * taken off stay on the trip page, which still says where they stand.
 */
const ON_TRIP: ReadonlySet<Standing> = new Set(["board", "paid", "due"]);

/** Day only: which weekend it is. The departure time is the trip page's job. */
function tripDates(trip: MemberTrip): string {
  const departs = formatDenver(trip.departAt, DAY_ONLY);
  if (!trip.returnAt) return departs;

  const returns = formatDenver(trip.returnAt, DAY_ONLY);
  return departs === returns ? departs : `${departs} - ${returns}`;
}

function CardAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center rounded-md border border-border-strong px-3 text-sm font-medium text-ink transition-colors hover:bg-surface"
    >
      {children}
    </Link>
  );
}

export default async function MyTripsPage() {
  const session = await auth();
  const memberId = session?.user?.memberId;
  const trips = (memberId ? await listMemberTrips(memberId) : []).filter((trip) =>
    ON_TRIP.has(standingOf(trip)),
  );

  // "Past" is decided by the return date rather than by status: a trip you paid
  // for is still upcoming until it actually happens.
  const now = Date.now();
  const isPast = (trip: MemberTrip) => new Date(trip.returnAt ?? trip.departAt).getTime() < now;
  const sections = [
    { title: "Upcoming", past: false, trips: trips.filter((trip) => !isPast(trip)) },
    { title: "Past trips", past: true, trips: trips.filter(isPast) },
  ];

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <DrawnTitle name="my-trips">My trips</DrawnTitle>

      {trips.length === 0 ? (
        <Card className="mt-6">
          <p className="text-sm text-ink-muted">
            You are not on any trips yet.{" "}
            <Link href="/" className="text-accent underline underline-offset-4">
              See what is coming up
            </Link>
            .
          </p>
        </Card>
      ) : null}

      {sections.map((section) =>
        section.trips.length > 0 ? (
          <section key={section.title} className="mt-8">
            <SectionHeading className="mb-3">{section.title}</SectionHeading>
            <div className="space-y-3">
              {section.trips.map((trip) => (
                <TripCard key={trip.tripId} trip={trip} past={section.past} />
              ))}
            </div>
          </section>
        ) : null,
      )}
    </main>
  );
}

function TripCard({ trip, past }: { trip: MemberTrip; past: boolean }) {
  const standing = standingOf(trip);
  const going = standing === "board" || standing === "paid";

  // The roster and the ride sheet are readable only by riders marked paid, so
  // nobody else is offered a link that ends at a locked page.
  const showRosterLinks = going && trip.rosterFinalizedAt !== null;

  return (
    <div className="rounded-lg border border-border bg-paper p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={`/trips/${trip.slug}`}
            className="font-medium text-ink underline-offset-4 hover:underline"
          >
            {trip.title}
          </Link>
          <p className="mt-1 text-sm text-ink-muted">
            {tripDates(trip)}
            {trip.resort ? ` · ${trip.resort}` : ""}
          </p>
        </div>
        <Badge emphasis={going ? "strong" : "normal"}>{STANDING_LABEL[standing]}</Badge>
      </div>

      {!past && standing === "due" ? (
        <div className="mt-4">
          <StandingNotice standing={standing} signup={trip} />
        </div>
      ) : null}

      {showRosterLinks || past ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {/* A past trip's ride sheet is just stale phone numbers. */}
          {showRosterLinks && !past ? (
            <CardAction href={`/trips/${trip.slug}/rides`}>Rides</CardAction>
          ) : null}
          {showRosterLinks ? (
            <CardAction href={`/trips/${trip.slug}/roster`}>Roster</CardAction>
          ) : null}
          {/* Galleries fill once a trip has happened. */}
          {past ? <CardAction href={`/photos/trips/${trip.slug}`}>Photos</CardAction> : null}
        </div>
      ) : null}
    </div>
  );
}
