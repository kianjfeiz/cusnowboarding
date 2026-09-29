import { NextResponse, type NextRequest } from "next/server";
import { execute } from "@/lib/db";
import { HOLD_GRACE_INTERVAL } from "@/lib/roster/holds";
import { releaseLapsedHolds, withTripLock } from "@/lib/roster/promotion";
import { isAuthorizedCron } from "@/lib/auth/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Releases unpaid holds whose deadline has lapsed, freeing the spot_number for
 * promotion. Correctness never depends on this running: every page applies
 * lazy expiry on read. DELIBERATELY SILENT - this job emails nobody.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Per trip, under the trips row lock: this job nulls spot numbers, and the
  // lock-ordering rule has no exceptions. The candidate query is a loose read;
  // releaseLapsedHolds re-checks everything once the lock is held.
  const candidates = await execute<{ id: string }>(
    `select distinct t.id
       from trips t
       join signups s on s.trip_id = t.id
      where s.status = 'held'
        and s.payment_deadline_at <= now() - ${HOLD_GRACE_INTERVAL}
        and t.results_released_at is not null
        and t.archived_at is null`,
  );

  let released = 0;
  for (const trip of candidates) {
    const rows = await withTripLock(trip.id, (client) =>
      releaseLapsedHolds(client, trip.id),
    );
    released += rows.length;
  }

  return NextResponse.json({ released, trips: candidates.length });
}

// Vercel cron issues GET requests.
export const GET = POST;
