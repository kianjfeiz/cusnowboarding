import { pool, execute } from "@/lib/db";
import { compBoardMembers } from "@/lib/board-seats";
import { sendEmail } from "@/lib/email/send";
import { gotASpotEmail, waitlistedEmail } from "@/lib/email/result-templates";
import { renumberWaitlist } from "@/lib/promotion";

/**
 * Publishing outcomes to members. The one irreversible board action of a drop.
 *
 * The drop decides the initial allocation; the board then spends fifteen or
 * twenty minutes curating the waitlist before anyone is told anything. Until
 * release, every entrant sees the same neutral "entry received".
 *
 * Releasing does five things, and the third is the one that is easy to miss:
 *
 *   1. CLOSES SIGNUPS. Publishing a roster while the drop is still accepting
 *      entries would hand a spot to someone after the results went out, with
 *      no email and no place in the list everyone was just shown. There was a
 *      separate "Close signups" button for this; leaving the two apart meant
 *      the safe order was something the board had to remember at 8:20pm.
 *   2. Marks the trip released, which is what unlocks the member views.
 *   3. RESETS the payment deadline on every held signup to now + the trip's
 *      payment window. The clock has to start when the member can actually act.
 *      Left alone, a board releasing an hour late would be running down a
 *      deadline against people who had not yet been told they had a spot.
 *   4. FINALIZES THE ROSTER, which opens the attendee list, the ride sheet and
 *      the photo pool. This used to be a second button pressed days later, to
 *      avoid publishing a list that was still churning. It does not need to be:
 *      every one of those views lists `status = 'paid'` only and is readable
 *      only by someone who is themselves paid, so at release the list is empty
 *      and fills as the money lands. Nobody unpaid is named, which was the
 *      whole reason for the delay.
 *   5. Emails everyone their outcome.
 *
 * All four writes are one transaction under the trips row lock, so there is no
 * window where the trip is released but still claimable.
 */

export interface ReleaseResult {
  ok: boolean;
  reason?: "already_released" | "trip_missing";
  spotEmails?: number;
  waitlistEmails?: number;
  failed?: number;
}

export async function releaseResults(
  tripId: string,
  boardUserId: string | null,
): Promise<ReleaseResult> {
  const client = await pool.connect();

  let recipients: Array<{
    email: string;
    first_name: string;
    status: string;
    spot_number: number | null;
    amount_cents: number;
    pay_token: string;
    payment_deadline_at: Date | null;
    trip_title: string;
  }> = [];

  try {
    await client.query("begin");

    // Locks the trip for the same reason promotion does: releasing while a
    // coordinator is moving people between the roster and the waitlist would
    // email a state that never existed.
    const { rows: tripRows } = await client.query<{
      results_released_at: Date | null;
      payment_window_hours: number;
      title: string;
    }>(
      `select results_released_at, payment_window_hours, title
         from trips where id = $1 for update`,
      [tripId],
    );

    if (tripRows.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "trip_missing" };
    }
    if (tripRows[0].results_released_at) {
      await client.query("rollback");
      return { ok: false, reason: "already_released" };
    }

    await client.query(
      `update trips
          set results_released_at = now(),
              results_released_by = $2,
              roster_finalized_at = now(),
              roster_finalized_by = $2,
              -- The claim statement only accepts 'scheduled' and 'open', so
              -- this is what actually stops entries. A trip already cancelled
              -- or closed early keeps the status it has - this must only ever
              -- close signups, never reopen them.
              status = case when status in ('draft','scheduled','open')
                            then 'closed'::trip_status else status end,
              updated_at = now()
        where id = $1`,
      [tripId, boardUserId],
    );

    /*
      Before the deadlines are set, not after: a board member who entered the
      drop like anybody else is comped here, and comping clears the deadline
      this next statement would otherwise have just given them. Doing it in this
      order also hands their spot number back to the trip before anything counts
      what is free.
    */
    const comped = await compBoardMembers(client, tripId);
    if (comped > 0) await renumberWaitlist(client, tripId);

    await client.query(
      `update signups
          set payment_deadline_at = now() + make_interval(hours => $2::int),
              updated_at = now()
        where trip_id = $1 and status = 'held'`,
      [tripId, tripRows[0].payment_window_hours],
    );

    const { rows } = await client.query(
      `select m.email::text as email, m.first_name, s.status::text as status,
              s.spot_number, s.amount_cents, s.pay_token, s.payment_deadline_at,
              t.title as trip_title
         from signups s
         join members m on m.id = s.member_id
         join trips t on t.id = s.trip_id
        where s.trip_id = $1 and s.status in ('held','paid','waitlisted')
          -- The board is not told it is on the trips it runs. Their seat is
          -- comped and has no deadline, so the email would carry no news and
          -- no action - just one more message per drop for the people already
          -- reading every other one.
          and not s.board_seat
        order by s.claim_seq`,
      [tripId],
    );
    recipients = rows;

    await client.query(
      `insert into audit_events (actor_board_user_id, action, entity_type, entity_id, data)
       values ($1, 'trip.results_released', 'trip', $2, $3::jsonb)`,
      [
        boardUserId,
        tripId,
        // One event, because it was one decision. The two flags record that
        // this release is what closed and finalized the trip, so a reader of
        // the log does not go looking for the separate actions that used to
        // leave their own rows.
        JSON.stringify({
          recipients: recipients.length,
          closedSignups: true,
          finalized: true,
          compedBoardMembers: comped,
        }),
      ],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  // Sent after the commit. A mail provider outage must not roll back a release
  // that members may already have seen on the site.
  let spotEmails = 0;
  let waitlistEmails = 0;
  let failed = 0;

  for (const row of recipients) {
    try {
      if (row.status === "waitlisted") {
        await sendEmail(
          waitlistedEmail({
            to: row.email,
            firstName: row.first_name,
            tripTitle: row.trip_title,
          }),
        );
        waitlistEmails += 1;
      } else {
        await sendEmail(
          gotASpotEmail({
            to: row.email,
            firstName: row.first_name,
            tripTitle: row.trip_title,
            spotNumber: row.spot_number ?? 0,
            amountCents: row.amount_cents,
            deadline: row.payment_deadline_at ?? new Date(),
            payToken: row.pay_token,
          }),
        );
        spotEmails += 1;
      }
    } catch (error) {
      failed += 1;
      console.error("result email failed", row.email, error);
    }
  }

  return { ok: true, spotEmails, waitlistEmails, failed };
}

/** Members see outcomes only once the board has published them. */
export async function areResultsReleased(tripId: string): Promise<boolean> {
  const rows = await execute<{ released: boolean }>(
    `select results_released_at is not null as released from trips where id = $1`,
    [tripId],
  );
  return rows[0]?.released ?? false;
}
