import { execute } from "@/lib/db";
import { HOLD_GRACE_MINUTES } from "@/lib/roster/holds";

/**
 * Money lives in Fusion, not here. Fusion has no public API, so this app cannot
 * observe payment: `signups.status = 'paid'` records a human decision by the
 * treasurer, and carries a note saying where the money came from.
 */

export interface PaySignup {
  id: string;
  payToken: string;
  status: string;
  spotNumber: number | null;
  paymentDeadlineAt: Date | null;
  paidAt: Date | null;
  amountCents: number;
  paidOffline: boolean;
  offlineNote: string | null;
  /** Comped board rider: nothing owed, and not one of the trip's spots. */
  boardSeat: boolean;
  email: string;
  firstName: string;
  tripId: string;
  memberId: string;
  tripTitle: string;
  tripSlug: string;
  resort: string | null;
  departAt: Date;
  returnAt: Date | null;
  /** Where members are sent to pay. Falls back to the club-wide portal. */
  paymentUrl: string | null;
  resultsReleased: boolean;
}

/**
 * `lapsed` covers both the terminal statuses and a hold whose deadline has
 * passed but whose release cron has not run yet, with the same grace window the
 * reaper uses (see lib/roster/holds.ts).
 *
 * `pending` is the pre-release state: they entered, but the board has not
 * published outcomes, so there is nothing to tell them and nothing to pay yet.
 */
export type PayState =
  | { kind: "not_found" }
  | { kind: "pending"; signup: PaySignup }
  | { kind: "paid"; signup: PaySignup }
  | { kind: "lapsed"; signup: PaySignup }
  | { kind: "waitlisted"; signup: PaySignup }
  | { kind: "due"; signup: PaySignup };

// The columns are aliased to `PaySignup`, so a row is the signup.
const PAY_SQL = `
select s.id, s.pay_token as "payToken", s.status::text as status,
       s.spot_number as "spotNumber", s.payment_deadline_at as "paymentDeadlineAt",
       s.paid_at as "paidAt", s.amount_cents as "amountCents",
       s.paid_offline as "paidOffline", s.offline_note as "offlineNote",
       s.board_seat as "boardSeat", s.trip_id as "tripId", s.member_id as "memberId",
       m.email::text as email, m.first_name as "firstName",
       t.title as "tripTitle", t.slug as "tripSlug", t.resort,
       t.depart_at as "departAt", t.return_at as "returnAt",
       t.payment_url as "paymentUrl",
       t.results_released_at is not null as "resultsReleased"
  from signups s
  join members m on m.id = s.member_id
  join trips   t on t.id = s.trip_id
 where s.pay_token = $1
   and t.archived_at is null
`;

export function classify(signup: PaySignup, now: Date = new Date()): PayState {
  if (signup.status === "paid") return { kind: "paid", signup };

  // Nothing is revealed, and nothing is owed, until the board publishes. That
  // includes the spot number: rendering it (or its absence, for a waitlisted
  // entrant) would tell the member the outcome before results go out.
  if (!signup.resultsReleased && (signup.status === "held" || signup.status === "waitlisted")) {
    return { kind: "pending", signup: { ...signup, spotNumber: null } };
  }

  if (signup.status === "waitlisted") return { kind: "waitlisted", signup };
  if (signup.status !== "held") return { kind: "lapsed", signup };

  const deadline = signup.paymentDeadlineAt;
  const cutoff = now.getTime() - HOLD_GRACE_MINUTES * 60_000;
  if (deadline === null || deadline.getTime() <= cutoff) {
    return { kind: "lapsed", signup };
  }

  return { kind: "due", signup };
}

export async function loadPayState(payToken: string): Promise<PayState> {
  const [signup] = await execute<PaySignup>(PAY_SQL, [payToken]);
  return signup ? classify(signup) : { kind: "not_found" };
}

/**
 * Club-wide fallback for trips with no specific payment link, so a board member
 * forgetting to set one still leaves members somewhere to go.
 */
export function clubPaymentUrl(): string | null {
  return process.env.NEXT_PUBLIC_PAYMENT_URL || null;
}

export function paymentUrlFor(signup: Pick<PaySignup, "paymentUrl">): string | null {
  return signup.paymentUrl || clubPaymentUrl();
}
