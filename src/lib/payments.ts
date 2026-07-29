import { execute } from "@/lib/db";
import { HOLD_GRACE_MINUTES } from "@/lib/holds";

/**
 * Money lives in Fusion, not here.
 *
 * The club bills through CU's Fusion club-sports portal, which processes the
 * payment and has no public API to query - so this app cannot know, on its own,
 * whether someone has paid. It deliberately does not try. What it owns is the
 * roster and the deadline; Fusion owns the money.
 *
 * That makes `signups.status = 'paid'` a record of a human decision: the
 * treasurer reconciled a Fusion payment (or cash, or Venmo) and recorded it.
 * Every paid row therefore carries a note saying where the money came from,
 * because six weeks later that note is the only thing distinguishing a real
 * payment from a misclick.
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
 * passed but whose release cron has not run yet, so a missed cron never shows
 * someone a payment prompt for a spot they no longer have. The same grace
 * window the reaper uses is applied here - see lib/holds.ts for why they must
 * agree.
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

interface PayRow {
  id: string;
  pay_token: string;
  status: string;
  spot_number: number | null;
  payment_deadline_at: Date | null;
  paid_at: Date | null;
  amount_cents: number;
  paid_offline: boolean;
  offline_note: string | null;
  email: string;
  first_name: string;
  trip_id: string;
  member_id: string;
  trip_title: string;
  trip_slug: string;
  resort: string | null;
  depart_at: Date;
  return_at: Date | null;
  payment_url: string | null;
  results_released: boolean;
}

const PAY_SQL = `
select s.id, s.pay_token, s.status::text as status, s.spot_number,
       s.payment_deadline_at, s.paid_at, s.amount_cents, s.paid_offline,
       s.offline_note, s.trip_id, s.member_id,
       m.email::text as email, m.first_name,
       t.title as trip_title, t.slug as trip_slug, t.resort, t.depart_at,
       t.return_at, t.payment_url,
       t.results_released_at is not null as results_released
  from signups s
  join members m on m.id = s.member_id
  join trips   t on t.id = s.trip_id
 where s.pay_token = $1
`;

function toSignup(row: PayRow): PaySignup {
  return {
    id: row.id,
    payToken: row.pay_token,
    status: row.status,
    spotNumber: row.spot_number,
    paymentDeadlineAt: row.payment_deadline_at,
    paidAt: row.paid_at,
    amountCents: row.amount_cents,
    paidOffline: row.paid_offline,
    offlineNote: row.offline_note,
    email: row.email,
    firstName: row.first_name,
    tripId: row.trip_id,
    memberId: row.member_id,
    tripTitle: row.trip_title,
    tripSlug: row.trip_slug,
    resort: row.resort,
    departAt: row.depart_at,
    returnAt: row.return_at,
    paymentUrl: row.payment_url,
    resultsReleased: row.results_released,
  };
}

export function classify(signup: PaySignup, now: Date = new Date()): PayState {
  if (signup.status === "paid") return { kind: "paid", signup };

  // Nothing is revealed, and nothing is owed, until the board publishes.
  if (!signup.resultsReleased && (signup.status === "held" || signup.status === "waitlisted")) {
    return { kind: "pending", signup };
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
  const rows = await execute<PayRow>(PAY_SQL, [payToken]);
  const row = rows[0];
  if (!row) return { kind: "not_found" };
  return classify(toSignup(row));
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
