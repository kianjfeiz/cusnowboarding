import { execute } from "@/lib/db";
import { LIVE_TRIP_STATUSES, isOwing, paymentState } from "../_lib/payment-queries";

/** A batch this size is already a mistake; refusing beats mailing the club twice. */
export const MAX_BATCH = 300;

export type UnpaidRecipient = {
  signup_id: string;
  first_name: string;
  last_name: string;
  email: string;
  pay_token: string;
  amount_cents: number;
  signup_status: string;
  payment_deadline_at: Date;
  trip_title: string;
  lapsed: boolean;
};

/**
 * Who still owes the club money, for the batch reminder.
 *
 * The decision is made by `paymentState`, the same function the table and the
 * CSV use, so the count the treasurer previews cannot drift from the screen.
 * A lapsed hold is opt-in: its spot is on its way to the waitlist, and asking
 * for money for it may be asking for money for nothing.
 *
 * Trips whose results are not out yet are excluded outright. Until release the
 * member has only been told their entry was received, so a demand for payment
 * would be the first they hear of a spot - with a deadline the release is about
 * to reset anyway. The expiry job skips these trips for the same reason.
 */
export async function listUnpaidRecipients(
  tripId: string | null,
  includeLapsed: boolean,
  now: number = Date.now(),
): Promise<UnpaidRecipient[]> {
  const rows = await execute<Omit<UnpaidRecipient, "lapsed">>(
    `select s.id as signup_id, s.amount_cents, s.pay_token, s.payment_deadline_at,
            s.status::text as signup_status,
            m.first_name, m.last_name, m.email::text as email,
            t.title as trip_title
       from signups s
       join trips   t on t.id = s.trip_id
       join members m on m.id = s.member_id
      where s.status = 'held'
        and s.paid_at is null
        and t.status in ${LIVE_TRIP_STATUSES}
        and t.archived_at is null
        and t.results_released_at is not null
        and ($1::uuid is null or s.trip_id = $1)
      order by t.depart_at, t.title, s.spot_number nulls last, s.claim_seq
      limit $2`,
    [tripId, MAX_BATCH + 1],
  );

  return rows.flatMap((row) => {
    const state = paymentState(row, now);
    if (!isOwing(state) || (state === "lapsed" && !includeLapsed)) return [];
    return [{ ...row, lapsed: state === "lapsed" }];
  });
}
