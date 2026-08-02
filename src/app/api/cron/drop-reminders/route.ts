import { NextResponse, type NextRequest } from "next/server";
import { execute } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { readyForDropEmail } from "@/lib/email/templates";
import { issueReadyToken } from "@/lib/member-session";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Hours before a drop at which verified members are reminded. */
const THRESHOLDS = [24, 1] as const;

/**
 * Tells verified members a drop is coming, and gives them a link that re-arms
 * the verification cookie.
 *
 * This exists to solve a specific failure: someone verifies on their laptop in
 * October, then at 8pm on a Tuesday in January they open the trip page on their
 * phone and have no cookie. Without this they would discover that at the worst
 * possible moment, and the only fix - verifying right then - is exactly what
 * the design refuses to allow, because it would create a two-speed race.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let sent = 0;

  for (const hours of THRESHOLDS) {
    const trips = await execute<{
      id: string;
      slug: string;
      title: string;
      signup_opens_at: Date;
      requires_dues: boolean;
    }>(
      `select t.id, t.slug, t.title, t.signup_opens_at, t.requires_dues
         from trips t
        where t.status in ('scheduled','open')
          and t.archived_at is null
          and t.signup_opens_at > now()
          and t.signup_opens_at <= now() + make_interval(hours => $1::int)
          and not exists (
            select 1 from audit_events a
             where a.entity_type = 'trip'
               and a.entity_id = t.id
               and a.action = 'trip.drop_reminder'
               and a.data->>'threshold' = $1::text
          )`,
      [hours],
    );

    for (const trip of trips) {
      const members = await execute<{
        id: string;
        email: string;
        first_name: string;
        token_version: number;
      }>(
        `select id, email, first_name, token_version
           from members
          where email_verified_at is not null
            and is_blocked = false
            -- No point nudging someone the trip would reject at claim time.
            and (is_club_member or not $2::boolean)
            -- Nobody who already has a spot on this trip needs the nudge.
            and not exists (
              select 1 from signups s
               where s.member_id = members.id and s.trip_id = $1
                 and s.status in ('held','paid','waitlisted')
            )`,
        [trip.id, trip.requires_dues],
      );

      for (const member of members) {
        try {
          await sendEmail(
            readyForDropEmail({
              to: member.email,
              firstName: member.first_name,
              tripTitle: trip.title,
              opensAt: trip.signup_opens_at,
              tripSlug: trip.slug,
              readyToken: await issueReadyToken({
                memberId: member.id,
                tokenVersion: member.token_version,
              }),
            }),
          );
          sent += 1;
        } catch (error) {
          console.error("drop reminder failed", member.email, error);
        }
      }

      // Recorded per trip and threshold, so a partial failure retries the whole
      // trip next run rather than double-mailing everyone.
      await execute(
        `insert into audit_events (action, entity_type, entity_id, data)
         values ('trip.drop_reminder', 'trip', $1, $2::jsonb)`,
        [trip.id, JSON.stringify({ threshold: String(hours), recipients: members.length })],
      );
    }
  }

  return NextResponse.json({ sent });
}

export const GET = POST;
