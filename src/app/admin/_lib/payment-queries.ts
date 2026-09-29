import { execute } from "@/lib/db";
import type { TripStatus } from "@/lib/db/schema";
import {
  PAYMENT_PROVIDER_LABELS,
  parsePaymentProvider,
  type PaymentProvider,
} from "@/lib/money/payment-providers";
import { HOLD_GRACE_INTERVAL, HOLD_GRACE_MINUTES } from "@/lib/roster/holds";

/**
 * Read models for the treasurer's view of the money.
 *
 * Fusion has no API, so nothing here observes a payment. Every `paid` row is a
 * treasurer's decision, recorded by hand; the `payments` row beside it is the
 * note of where the money came from. Amounts are integer cents end to end.
 */

/** Trips whose money is still in play. Matches the dashboard's definition. */
export const LIVE_TRIP_STATUSES = "('scheduled', 'open', 'closed')";

export type PaymentState =
  | "paid"
  | "unpaid"
  | "lapsed"
  | "waitlisted"
  | "released"
  | "cancelled"
  | "refunded";

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  lapsed: "Hold lapsed",
  waitlisted: "Waitlisted",
  released: "Removed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/**
 * What the row means to the treasurer right now. Same lazy expiry and the same
 * grace (lib/roster/holds.ts) as `effectiveStatus` in queries.ts, so this table
 * and the roster never disagree about whether a hold has lapsed.
 */
export function paymentState(
  row: { signup_status: string; payment_deadline_at: Date | null },
  now: number = Date.now(),
): PaymentState {
  if (row.signup_status === "held") {
    const deadline = row.payment_deadline_at
      ? new Date(row.payment_deadline_at).getTime()
      : null;
    const cutoff = now - HOLD_GRACE_MINUTES * 60_000;
    return deadline !== null && deadline <= cutoff ? "lapsed" : "unpaid";
  }
  if (row.signup_status === "expired") return "released";
  return row.signup_status as PaymentState;
}

/** A lapsed hold is still a member who has not paid, so "owing" spans both. */
export function isOwing(state: PaymentState): boolean {
  return state === "unpaid" || state === "lapsed";
}

/**
 * One line saying where the money came from, written to `signups.offline_note`
 * as well as the payments row: the roster, its CSV and the member's own payment
 * page read that column and know nothing about payments rows.
 */
export function paymentSummary(input: {
  provider: PaymentProvider;
  reference?: string | null;
  note?: string | null;
}): string {
  const parts = [
    PAYMENT_PROVIDER_LABELS[input.provider],
    input.reference?.trim(),
    input.note?.trim(),
  ];
  return parts.filter(Boolean).join(", ");
}

export type PaymentLine = {
  signup_id: string;
  signup_status: string;
  spot_number: number | null;
  amount_cents: number;
  claimed_at: Date;
  payment_deadline_at: Date | null;
  paid_at: Date | null;
  paid_offline: boolean;
  offline_note: string | null;
  trip_id: string;
  trip_title: string;
  trip_slug: string;
  trip_status: TripStatus;
  first_name: string;
  last_name: string;
  email: string;
  payment_status: string | null;
  payment_provider: string | null;
  payment_reference: string | null;
  payment_note: string | null;
  refunded_cents: number;
};

/**
 * The whole ledger for one trip or all of them. Status filtering happens in the
 * caller, on `paymentState`, so the lapsed rule lives in exactly one place.
 */
export async function listPaymentLines(tripId: string | null): Promise<PaymentLine[]> {
  return execute<PaymentLine>(
    `select s.id as signup_id, s.status::text as signup_status, s.spot_number,
            s.amount_cents, s.claimed_at, s.payment_deadline_at, s.paid_at,
            s.paid_offline, s.offline_note,
            t.id as trip_id, t.title as trip_title, t.slug as trip_slug,
            t.status::text as trip_status,
            m.first_name, m.last_name, m.email::text as email,
            p.status::text as payment_status, p.provider as payment_provider,
            p.reference as payment_reference, p.note as payment_note,
            coalesce(p.refunded_cents, 0) as refunded_cents
       from signups s
       join trips t on t.id = s.trip_id
       join members m on m.id = s.member_id
       left join lateral (
         select id, status, provider, reference, note, refunded_cents
           from payments
          where signup_id = s.id
          -- Newest wins. A correction is recorded as a second row rather than
          -- an edit, so the latest one is the treasurer's current answer.
          order by created_at desc
          limit 1
       ) p on true
      where ($1::uuid is null or s.trip_id = $1)
        and t.archived_at is null
        -- A comped board seat is 'paid' at zero with no payment behind it.
        and not s.board_seat
        -- Payment-bearing: allocated a spot, or money changed hands at some
        -- point even though the spot is gone.
        and (s.status in ('held', 'paid', 'refunded') or p.id is not null)
      order by t.depart_at, t.title, s.spot_number nulls last, s.claim_seq
      limit 1000`,
    [tripId],
  );
}

/**
 * The payments row is preferred over `offline_note` because it carries a
 * reference the treasurer can look up again. A `paid` signup with neither says
 * so plainly rather than inventing a source.
 */
export function paidVia(row: PaymentLine): { label: string; note: string | null } {
  if (row.payment_status === "paid" || row.payment_status === "refunded") {
    const provider = parsePaymentProvider(row.payment_provider);
    const detail = row.payment_reference?.trim() || row.payment_note?.trim() || null;
    return { label: PAYMENT_PROVIDER_LABELS[provider], note: detail };
  }
  if (row.paid_offline) return { label: "Recorded by hand", note: row.offline_note };
  if (row.signup_status === "paid") return { label: "Source not recorded", note: null };
  return { label: "-", note: null };
}

export type PaymentTotals = {
  /** Owed by every live hold, lapsed or not. */
  outstanding_cents: number;
  collected_cents: number;
  paid_count: number;
  unpaid_count: number;
  lapsed_count: number;
};

export async function getPaymentTotals(): Promise<PaymentTotals> {
  // An aggregate with no GROUP BY always returns exactly one row.
  const [totals] = await execute<PaymentTotals>(
    `select
       coalesce(sum(s.amount_cents) filter (where s.status = 'held'), 0)::int
         as outstanding_cents,
       coalesce(sum(s.amount_cents) filter (where s.status = 'paid'), 0)::int
         as collected_cents,
       count(*) filter (where s.status = 'paid')::int as paid_count,
       count(*) filter (where s.status = 'held'
         and (s.payment_deadline_at > now() - ${HOLD_GRACE_INTERVAL}
              or t.results_released_at is null))::int
         as unpaid_count,
       -- Grace and release state both mirror the reaper: a hold is not lapsed
       -- while the treasurer may be mid-recording, nor before the member was
       -- ever given a real deadline.
       count(*) filter (where s.status = 'held'
         and s.payment_deadline_at <= now() - ${HOLD_GRACE_INTERVAL}
         and t.results_released_at is not null)::int
         as lapsed_count
     from signups s
     join trips t on t.id = s.trip_id
     where t.status in ${LIVE_TRIP_STATUSES}
       and t.archived_at is null
       -- A comped board seat adds nothing to the sums, but it would add one to
       -- paid_count for a rider nobody collected from.
       and not s.board_seat`,
  );
  return totals;
}

export type PaymentTrip = {
  id: string;
  title: string;
  /** Money still in play: the scope of the reminder batch and the totals. */
  is_live: boolean;
  /** Where members are sent to pay. Null until the board sets one. */
  payment_url: string | null;
};

/** Every published trip, not only the live ones - reconciliation happens after the fact. */
export async function listPaymentTrips(): Promise<PaymentTrip[]> {
  return execute<PaymentTrip>(
    `select id, title, payment_url, status in ${LIVE_TRIP_STATUSES} as is_live
       from trips
      where status <> 'draft'
        and archived_at is null
      order by depart_at desc
      limit 200`,
  );
}

/**
 * The trip id arrives from the query string and reaches a `::uuid` cast, so
 * anything that is not a trip we already listed is dropped rather than handed
 * to Postgres to reject.
 */
export function resolveTripId(
  raw: string | null | undefined,
  trips: PaymentTrip[],
): string | null {
  return raw && trips.some((trip) => trip.id === raw) ? raw : null;
}
