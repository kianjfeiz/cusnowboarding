import { execute } from "@/lib/db";
import { paymentState } from "../_lib/payment-queries";

/**
 * Who still owes the club money, for the batch reminder.
 *
 * "Unpaid" is not re-derived here. The rows come back raw and the decision is
 * made by `paymentState` from payment-queries, the same function the table and
 * the CSV use, so the count the treasurer is shown before sending cannot drift
 * from what the screen says. That matters more than usual: this is the one
 * control that contacts members in bulk, and a definition that disagreed with
 * the table would send mail to people the treasurer never saw.
 *
 * Two states qualify:
 *   - `unpaid`  a hold still inside its payment window. Always included.
 *   - `lapsed`  a hold past its deadline whose row has not been released yet.
 *               Opt-in, because the spot is on its way to the waitlist and
 *               asking for money for it may be asking for money for nothing.
 *
 * A signup whose row has already been released is not here at all: it is no
 * longer `held`, so there is no spot to pay for and no balance to chase.
 *
 * Trips whose results are not out yet are excluded outright. Until the board
 * releases results the member has been told only that their entry was received,
 * so a demand for payment would be the first they hear that they got a spot -
 * and it would arrive with a deadline that the release is about to reset
 * anyway. The expiry and reminder jobs skip these trips for the same reason.
 */

/** Trips whose money is still in play. Same set as the rest of the screen. */
const LIVE_TRIP_STATUSES = "('scheduled', 'open', 'closed')";

/** A batch this size is already a mistake; refusing beats mailing the club twice. */
export const MAX_BATCH = 300;

export type UnpaidRecipient = {
  signup_id: string;
  member_id: string;
  first_name: string;
  last_name: string;
  email: string;
  pay_token: string;
  amount_cents: number;
  signup_status: string;
  payment_deadline_at: Date;
  trip_id: string;
  trip_title: string;
  lapsed: boolean;
};

export async function listUnpaidRecipients(
  tripId: string | null,
  includeLapsed: boolean,
  now: number = Date.now(),
): Promise<UnpaidRecipient[]> {
  const rows = await execute<Omit<UnpaidRecipient, "lapsed">>(
    `select s.id as signup_id, s.amount_cents, s.pay_token, s.payment_deadline_at,
            s.status::text as signup_status,
            m.id as member_id, m.first_name, m.last_name, m.email::text as email,
            t.id as trip_id, t.title as trip_title
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
    if (state !== "unpaid" && state !== "lapsed") return [];
    if (state === "lapsed" && !includeLapsed) return [];
    return [{ ...row, lapsed: state === "lapsed" }];
  });
}

/**
 * Identifies one batch: the same scope sent twice in a row is almost certainly
 * a double submit rather than a decision to mail everyone again.
 */
export function batchScopeKey(tripId: string | null, includeLapsed: boolean): string {
  return `${tripId ?? "all-live"}:${includeLapsed ? "with-lapsed" : "live-only"}`;
}
