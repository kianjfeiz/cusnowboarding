import { cache } from "react";
import { unstable_cache } from "next/cache";
import { desc, eq, inArray } from "drizzle-orm";
import { db, execute } from "@/lib/db";
import { trips, type Trip, type TripStatus } from "@/lib/db/schema";
import { HOLD_OCCUPIES_SQL } from "@/lib/holds";

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
 * `trips.claim_counter`. The counter assigns arrival order and may contain
 * gaps by design; only rows describe who is actually on the trip.
 *
 * Holds past their deadline are treated as expired here even if the release
 * cron has not run yet. Correctness must not depend on a cron firing.
 *
 * The grace window is applied here too, and must match the reaper's: a hold
 * that is past its deadline but not yet reclaimable still occupies its spot,
 * so reporting it as free would advertise a seat nobody can actually be put in.
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
     where trip_id = $1`,
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
      .where(inArray(trips.status, ["scheduled", "open", "closed"]))
      .orderBy(desc(trips.signupOpensAt))
      .limit(20),
  ["upcoming-trips"],
  { tags: ["trips"], revalidate: 300 },
);

/**
 * The public trip list, cached across requests and users.
 *
 * Safe to share because every column here is the same for everyone, and the
 * time-sensitive parts of the display ("signups open now") are computed from
 * these timestamps at render, not stored. The board's trip mutations
 * revalidate the `trips` tag, so edits show up immediately; the five-minute
 * revalidate is only a backstop for any write path the tag misses.
 *
 * Occupancy, signups, and anything member-specific stay uncached on purpose.
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

/**
 * `cache()` because `generateMetadata` and the page body both ask for the trip
 * on every visit; deduping turns those two identical queries into one. The
 * scope is a single request, so nothing here outlives or crosses a render.
 */
export const getTripBySlug = cache(async (slug: string): Promise<Trip | null> => {
  const [trip] = await db.select().from(trips).where(eq(trips.slug, slug)).limit(1);
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
  /**
   * `waitlist_position` is deliberately NOT selected. The board pulls from the
   * waitlist by judgement rather than strictly in order, so telling someone
   * they are "number 3" would promise a queue that does not exist. Members are
   * told they are on the waitlist and nothing more; the ordering stays visible
   * to the board only.
   */
  const rows = await execute<{
    status: string;
    spot_number: number | null;
    payment_deadline_at: Date | null;
    pay_token: string;
    amount_cents: number;
    results_released: boolean;
  }>(
    `select s.status::text as status, s.spot_number,
            s.payment_deadline_at, s.pay_token, s.amount_cents,
            t.results_released_at is not null as results_released
       from signups s
       join trips t on t.id = s.trip_id
      where s.trip_id = $1 and s.member_id = $2
        and s.status in ('held','paid','waitlisted')
      limit 1`,
    [tripId, memberId],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    status: row.status,
    spotNumber: row.spot_number,
    paymentDeadlineAt: row.payment_deadline_at,
    payToken: row.pay_token,
    amountCents: row.amount_cents,
    resultsReleased: row.results_released,
  };
}
