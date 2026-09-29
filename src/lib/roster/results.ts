import { compBoardMembers } from "@/lib/roster/board-seats";
import { sendEmail } from "@/lib/email/send";
import { resultEmail, type ResultRecipient } from "@/lib/email/templates";
import { auditInTransaction, renumberWaitlist, withTripLock } from "@/lib/roster/promotion";

/**
 * Publishing outcomes to members. The one irreversible board action of a drop.
 * Until release, every entrant sees the same neutral "entry received".
 *
 * Releasing does five things:
 *
 *   1. CLOSES SIGNUPS. Publishing a roster while the drop is still accepting
 *      entries would hand a spot to someone after the results went out.
 *   2. Marks the trip released, which is what unlocks the member views.
 *   3. RESETS the payment deadline on every held signup to now + the trip's
 *      payment window. The clock has to start when the member can actually act.
 *   4. FINALIZES THE ROSTER, which opens the attendee list and the ride sheet.
 *      Both list `status = 'paid'` only, so nobody unpaid is ever named.
 *   5. Emails every rider on the trip - the FIRST of the only two emails this
 *      app ever sends; the other is the treasurer's unpaid batch. The waitlist
 *      is not emailed; it sees where it stands on its own pages.
 *
 * The writes are one transaction under the trips row lock, so there is no
 * window where the trip is released but still claimable.
 */

export interface ReleaseResult {
  ok: boolean;
  reason?: "already_released" | "trip_missing" | "cancelled";
  /** Riders on the trip who were emailed. The waitlist and board seats are not. */
  emailed?: number;
  failed?: number;
}

export async function releaseResults(
  tripId: string,
  boardUserId: string | null,
): Promise<ReleaseResult> {
  // Locked for the same reason promotion is: releasing while a coordinator is
  // moving people between the roster and the waitlist would email a state that
  // never existed.
  const released = await withTripLock<
    { ok: true; recipients: ResultRecipient[] } | { ok: false; reason: ReleaseResult["reason"] }
  >(tripId, async (client, trip) => {
    if (!trip) return { ok: false, reason: "trip_missing" };
    if (trip.results_released_at) return { ok: false, reason: "already_released" };
    // The page hides the button on a cancelled trip; this is what stops a
    // direct post from emailing riders a roster for a trip that is not running.
    if (trip.status === "cancelled") return { ok: false, reason: "cancelled" };

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

    // Before the deadlines are set, not after: comping clears the deadline the
    // next statement would otherwise have just given a board member, and hands
    // their spot number back to the trip before anything counts what is free.
    const comped = await compBoardMembers(client, tripId);
    if (comped > 0) await renumberWaitlist(client, tripId);

    await client.query(
      `update signups
          set payment_deadline_at = now() + make_interval(hours => $2::int),
              updated_at = now()
        where trip_id = $1 and status = 'held'`,
      [tripId, trip.payment_window_hours],
    );

    const { rows: recipients } = await client.query<ResultRecipient>(
      `select m.email::text as email, m.first_name, s.status::text as status,
              s.amount_cents, s.pay_token, s.payment_deadline_at,
              t.title as trip_title
         from signups s
         join members m on m.id = s.member_id
         join trips t on t.id = s.trip_id
        where s.trip_id = $1 and s.status in ('held','paid')
          -- Only riders on the trip are emailed. The waitlist sees where it
          -- stands on its own pages, and the board is not told it is on the
          -- trips it runs: a comped seat carries no news and no action.
          and not s.board_seat
        order by s.claim_seq`,
      [tripId],
    );

    // One event, because it was one decision. The flags record that this
    // release is what closed and finalized the trip.
    await auditInTransaction(client, boardUserId, "trip.results_released", "trip", tripId, {
      recipients: recipients.length,
      closedSignups: true,
      finalized: true,
      compedBoardMembers: comped,
    });

    return { ok: true, recipients };
  });

  if (!released.ok) return released;

  // Sent after the commit. A mail provider outage must not roll back a release
  // that members may already have seen on the site.
  let emailed = 0;
  let failed = 0;

  for (const row of released.recipients) {
    try {
      await sendEmail(resultEmail(row));
      emailed += 1;
    } catch (error) {
      failed += 1;
      console.error("result email failed", row.email, error);
    }
  }

  return { ok: true, emailed, failed };
}
