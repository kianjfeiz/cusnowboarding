import { NextResponse, type NextRequest } from "next/server";
import { execute } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { paymentReminderEmail } from "@/lib/email/templates";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Hours-remaining thresholds at which a member gets nudged. */
const REMINDERS = [24, 3] as const;

/**
 * Nudges members with an unpaid hold before their deadline.
 *
 * Deduplication is done against audit_events rather than a column on signups,
 * so no schema change is needed and the send history stays auditable alongside
 * every other action taken on a signup.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let sent = 0;

  for (const hours of REMINDERS) {
    const due = await execute<{
      signup_id: string;
      email: string;
      first_name: string;
      trip_title: string;
      amount_cents: number;
      payment_deadline_at: Date;
      pay_token: string;
    }>(
      `select s.id as signup_id, m.email, m.first_name, t.title as trip_title,
              s.amount_cents, s.payment_deadline_at, s.pay_token
         from signups s
         join members m on m.id = s.member_id
         join trips   t on t.id = s.trip_id
        where s.status = 'held'
          -- Nobody is chased for money before they have been told they have a
          -- spot. Releasing results is what starts their payment window.
          and t.results_released_at is not null
          and s.payment_deadline_at > now()
          and s.payment_deadline_at <= now() + make_interval(hours => $1::int)
          and not exists (
            select 1 from payments p
             where p.signup_id = s.id and p.status = 'paid'
          )
          and not exists (
            select 1 from audit_events a
             where a.entity_type = 'signup'
               and a.entity_id = s.id
               and a.action = 'signup.reminder'
               and a.data->>'threshold' = $1::text
          )`,
      [hours],
    );

    for (const row of due) {
      try {
        await sendEmail(
          paymentReminderEmail({
            to: row.email,
            firstName: row.first_name,
            tripTitle: row.trip_title,
            amountCents: row.amount_cents,
            deadline: row.payment_deadline_at,
            payToken: row.pay_token,
            hoursLeft: hours,
          }),
        );

        // Recorded only after a successful send, so a provider outage results
        // in a retry next run rather than a silently skipped member.
        await execute(
          `insert into audit_events (action, entity_type, entity_id, data)
           values ('signup.reminder', 'signup', $1, $2::jsonb)`,
          [row.signup_id, JSON.stringify({ threshold: String(hours) })],
        );
        sent += 1;
      } catch (error) {
        console.error("reminder failed", row.signup_id, error);
      }
    }
  }

  return NextResponse.json({ sent });
}

export const GET = POST;
