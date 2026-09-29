import { cache } from "react";
import { unstable_cache } from "next/cache";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, execute } from "@/lib/db";
import { trips, type Trip, type TripStatus } from "@/lib/db/schema";
import { HOLD_OCCUPIES_SQL } from "@/lib/roster/holds";

export interface Occupancy {
  /** Spots genuinely taken right now: paid, plus holds that have not lapsed. */
  taken: number;
  paid: number;
  held: number;
  waitlisted: number;
  /** capacity - taken, floored at zero. */
  free: number;
}

/**
 * Occupancy is always computed from actual signup rows, never from
 * `trips.claim_counter`, which may contain gaps by design.
 *
 * Holds past their deadline are treated as expired here even if the release
 * cron has not run, with the same grace window the reaper uses: a hold not yet
 * reclaimable still occupies its spot. Comped board seats are excluded, because
 * capacity is a count of paying riders.
 */
export async function getOccupancy(tripId: string, capacity: number): Promise<Occupancy> {
  const rows = await execute<{
    paid: number;
    held: number;
    waitlisted: number;
  }>(
    `select
       count(*) filter (where status = 'paid')::int as paid,
       count(*) filter (where ${HOLD_OCCUPIES_SQL})::int as held,
       count(*) filter (where status = 'waitlisted')::int as waitlisted
     from signups
     where trip_id = $1 and not board_seat`,
    [tripId],
  );

  const { paid = 0, held = 0, waitlisted = 0 } = rows[0] ?? {};
  const taken = paid + held;

  return { taken, paid, held, waitlisted, free: Math.max(0, capacity - taken) };
}

/** Exactly what the home page's trip list renders, and nothing member-specific. */
export interface UpcomingTripRow {
  id: string;
  slug: string;
  title: string;
  resort: string | null;
  status: TripStatus;
  priceCents: number;
  capacity: number;
  departAt: Date;
  signupOpensAt: Date;
  signupClosesAt: Date | null;
}

const listUpcomingTripsCached = unstable_cache(
  async () =>
    db
      .select({
        id: trips.id,
        slug: trips.slug,
        title: trips.title,
        resort: trips.resort,
        status: trips.status,
        priceCents: trips.priceCents,
        capacity: trips.capacity,
        departAt: trips.departAt,
        signupOpensAt: trips.signupOpensAt,
        signupClosesAt: trips.signupClosesAt,
      })
      .from(trips)
      // archived_at is legacy - see NOT_ARCHIVED in trip-scope.ts.
      .where(and(inArray(trips.status, ["scheduled", "open", "closed"]), isNull(trips.archivedAt)))
      .orderBy(desc(trips.signupOpensAt))
      .limit(20),
  ["upcoming-trips"],
  { tags: ["trips"], revalidate: 300 },
);

/**
 * The public trip list, cached across requests and users. Safe to share because
 * every column is the same for everyone; occupancy, signups, and anything
 * member-specific stay uncached on purpose. Board mutations revalidate the
 * `trips` tag, and the five-minute revalidate is only a backstop.
 *
 * The map on the way out is not decorative: `unstable_cache` stores JSON, so
 * on a cache hit the timestamps arrive as ISO strings wearing `Date` types.
 */
export async function listUpcomingTrips(): Promise<UpcomingTripRow[]> {
  const rows = await listUpcomingTripsCached();
  return rows.map((row) => ({
    ...row,
    departAt: new Date(row.departAt),
    signupOpensAt: new Date(row.signupOpensAt),
    signupClosesAt: row.signupClosesAt ? new Date(row.signupClosesAt) : null,
  }));
}

/** `cache()` dedupes the two per-request reads from `generateMetadata` and the page body. */
export const getTripBySlug = cache(async (slug: string): Promise<Trip | null> => {
  // A trip archived in the past 404s rather than rendering a page nothing
  // links to. Legacy - see NOT_ARCHIVED in trip-scope.ts.
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.slug, slug), isNull(trips.archivedAt)))
    .limit(1);
  return trip ?? null;
});

export interface MemberSignupView {
  status: string;
  spotNumber: number | null;
  paymentDeadlineAt: Date | null;
  payToken: string;
  amountCents: number;
  /** False until the board publishes outcomes; the member sees nothing before. */
  resultsReleased: boolean;
}

export async function getMemberSignup(
  tripId: string,
  memberId: string,
): Promise<MemberSignupView | null> {
  // `waitlist_position` is deliberately NOT selected: the board picks from the
  // waitlist by judgement, so a number would promise a queue that does not exist.
  const rows = await execute<MemberSignupView>(
    `select s.status::text as status, s.spot_number as "spotNumber",
            s.payment_deadline_at as "paymentDeadlineAt", s.pay_token as "payToken",
            s.amount_cents as "amountCents",
            t.results_released_at is not null as "resultsReleased"
       from signups s
       join trips t on t.id = s.trip_id
      where s.trip_id = $1 and s.member_id = $2
        and s.status in ('held','paid','waitlisted')
        and t.archived_at is null
      limit 1`,
    [tripId, memberId],
  );
  return rows[0] ?? null;
}
