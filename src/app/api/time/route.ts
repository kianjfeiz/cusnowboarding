import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server clock, for the drop countdown.
 *
 * The client samples this a few times, takes the sample with the lowest round
 * trip, and uses it to compute a clock offset. A member whose device clock is
 * two minutes fast must not see the button arm two minutes early - and equally
 * must not be shown a countdown that lies to them in the other direction.
 *
 * This endpoint is a convenience for display only. The claim statement checks
 * `signup_opens_at <= now()` in the database, so a tampered client clock
 * cannot buy a single millisecond.
 */
export function GET() {
  return NextResponse.json(
    { now: Date.now() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
