import { NextResponse, type NextRequest } from "next/server";
import { execute, pool } from "@/lib/db";
import { releaseLapsedHolds } from "@/lib/promotion";
import { sendEmail } from "@/lib/email/send";
import { holdExpiredEmail, spotsOpenedEmail } from "@/lib/email/templates";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Releases unpaid holds whose deadline has lapsed.
 *
 * Correctness never depends on this running: every roster and pay page applies
 * lazy expiry on read, so a missed cron shows the right numbers regardless.
 * What this job actually buys is freeing the spot_number so the board can
 * promote someone into it, plus the notifications.
 *
 * Note that Vercel's Hobby plan caps crons at once per day. Either run on Pro
 * or trigger this from an external scheduler; a 15 minute cadence is assumed.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const released = await releaseLapsedHolds(pool);

  if (released.length === 0) {
    return NextResponse.json({ released: 0 });
  }

  // Tell the members whose spots went away.
  const details = await execute<{
    email: string;
    first_name: string;
    trip_title: string;
  }>(
    `select m.email, m.first_name, t.title as trip_title
       from signups s
       join members m on m.id = s.member_id
       join trips   t on t.id = s.trip_id
      where s.id = any($1::uuid[])`,
    [released.map((r) => r.id)],
  );

  for (const row of details) {
    await sendEmail(
      holdExpiredEmail({
        to: row.email,
        firstName: row.first_name,
        tripTitle: row.trip_title,
      }),
    ).catch((error) => console.error("expiry notice failed", error));
  }

  // Tell the coordinators there is something to do. Promotion stays manual by
  // design, so this notification is the trigger for it.
  const affectedTrips = [...new Set(released.map((r) => r.trip_id))];
  const summaries = await execute<{
    trip_id: string;
    title: string;
    freed: number;
    waitlist_depth: number;
  }>(
    `select t.id as trip_id,
            t.title,
            count(*) filter (where s.status = 'expired' and s.released_at > now() - interval '1 hour')::int as freed,
            count(*) filter (where s.status = 'waitlisted')::int as waitlist_depth
       from trips t
       join signups s on s.trip_id = t.id
      where t.id = any($1::uuid[])
      group by t.id, t.title`,
    [affectedTrips],
  );

  const coordinators = await execute<{ email: string }>(
    `select distinct bu.email
       from board_users bu
       join board_user_roles bur on bur.board_user_id = bu.id
      where bu.is_active and bur.role_key in ('travel','president','vp')`,
  );

  for (const summary of summaries) {
    if (summary.waitlist_depth === 0) continue;
    for (const coordinator of coordinators) {
      await sendEmail(
        spotsOpenedEmail({
          to: coordinator.email,
          tripTitle: summary.title,
          tripId: summary.trip_id,
          freedCount: summary.freed,
          waitlistDepth: summary.waitlist_depth,
        }),
      ).catch((error) => console.error("coordinator notice failed", error));
    }
  }

  return NextResponse.json({ released: released.length, trips: affectedTrips.length });
}

// Vercel cron issues GET requests.
export const GET = POST;
