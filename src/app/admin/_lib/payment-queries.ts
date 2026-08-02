import { execute } from "@/lib/db";
import type { TripStatus } from "@/lib/db/schema";

/**
 * Read models for the treasurer's view of the money.
 *
 * The club bills through CU's Fusion portal, which has no API, so nothing here
 * observes a payment. Every `paid` row is a treasurer's decision, recorded by
 * hand; the `payments` row beside it is the note of where the money came from.
 *
 * Two rules carry over from the roster read models and are repeated here rather
 * than imported, so this file can be read on its own:
 *
 *  - A `held` signup whose payment deadline has passed reads as lapsed even
 *    though the column still says held. The release cron may not have run, and
 *    a treasurer chasing payment needs to know the hold is already dead.
 *  - Occupancy comes from signup rows, never from `trips.claim_counter`.
 *
 * Amounts are integer cents end to end. Nothing in here divides.
 */

/** Trips whose money is still in play. Matches the dashboard's definition. */
const LIVE_TRIP_STATUSES = "('scheduled', 'open', 'closed')";

// ---------------------------------------------------------------------------
// State of a single payment-bearing signup
// ---------------------------------------------------------------------------

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
  released: "Released",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

interface StatefulRow {
  signup_status: string;
  payment_deadline_at: Date | null;
}

/**
 * What the row means to the treasurer right now. Same lazy expiry as
 * `effectiveStatus` in queries.ts; the only difference is vocabulary, because a
 * live hold is "unpaid" money rather than a "holding" spot.
 */
export function paymentState(row: StatefulRow, now: number = Date.now()): PaymentState {
  if (row.signup_status === "held") {
    const deadline = row.payment_deadline_at
      ? new Date(row.payment_deadline_at).getTime()
      : null;
    if (deadline !== null && deadline <= now) return "lapsed";
    return "unpaid";
  }
  if (row.signup_status === "expired") return "released";
  return row.signup_status as PaymentState;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * Three, because there are only three questions. "Owing" deliberately spans
 * both unpaid and lapsed: a lapsed hold is still a member who has not paid, and
 * splitting them meant a filter called Unpaid that hid people who owed money.
 * Which of the two a row is stays visible in its status word.
 */
export const PAYMENT_FILTERS = ["owing", "paid", "all"] as const;

export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

export const PAYMENT_FILTER_LABELS: Record<PaymentFilter, string> = {
  owing: "Owing",
  paid: "Paid",
  all: "Everyone",
};

export function parsePaymentFilter(raw: string | null | undefined): PaymentFilter {
  const found = PAYMENT_FILTERS.find((value) => value === raw);
  return found ?? "all";
}

/**
 * The trip id arrives from the query string and is interpolated into a `::uuid`
 * cast, so anything that is not a trip we already listed is dropped rather than
 * handed to Postgres to reject.
 */
export function resolveTripId(
  raw: string | null | undefined,
  trips: PaymentTripOption[],
): string | null {
  if (!raw) return null;
  return trips.some((trip) => trip.id === raw) ? raw : null;
}

// ---------------------------------------------------------------------------
// Where the money came from
// ---------------------------------------------------------------------------

/**
 * The provider vocabulary lives in `@/lib/payment-providers` because the
 * treasurer's form is a client component and cannot import this file - every
 * read model here pulls in the database. Re-exported so callers that already
 * think of providers as part of the payments read model keep working.
 */
export {
  PAYMENT_PROVIDERS,
  PAYMENT_PROVIDER_LABELS,
  parsePaymentProvider,
  requiresReference,
  type PaymentProvider,
} from "@/lib/payment-providers";

// Re-exporting does not bind these locally; the read models below use them.
import {
  PAYMENT_PROVIDER_LABELS,
  parsePaymentProvider,
  type PaymentProvider,
} from "@/lib/payment-providers";

/**
 * One line saying where the money came from, written to `signups.offline_note`
 * as well as the payments row. The roster, the roster CSV and the member's own
 * payment page all read that column and know nothing about payments rows, so
 * without this a Fusion payment would show up there as a bare "paid".
 */
export function paymentSummary(input: {
  provider: PaymentProvider;
  reference?: string | null;
  note?: string | null;
}): string {
  const parts = [PAYMENT_PROVIDER_LABELS[input.provider]];
  const reference = input.reference?.trim();
  const note = input.note?.trim();
  if (reference) parts.push(reference);
  if (note) parts.push(note);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// The main table
// ---------------------------------------------------------------------------

export type PaymentLine = {
  signup_id: string;
  claim_seq: number;
  signup_status: string;
  spot_number: number | null;
  waitlist_position: number | null;
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
  depart_at: Date;
  member_id: string;
  first_name: string;
  last_name: string;
  email: string;
  payment_id: string | null;
  payment_status: string | null;
  payment_provider: string | null;
  payment_reference: string | null;
  payment_note: string | null;
  refunded_cents: number;
  payment_created_at: Date | null;
};

export const LINE_LIMIT = 1000;

export async function listPaymentLines(
  tripId: string | null,
  limit = LINE_LIMIT,
): Promise<PaymentLine[]> {
  return execute<PaymentLine>(
    `select s.id as signup_id, s.claim_seq::int as claim_seq, s.status::text as signup_status,
            s.spot_number, s.waitlist_position, s.amount_cents, s.claimed_at,
            s.payment_deadline_at, s.paid_at, s.paid_offline, s.offline_note,
            t.id as trip_id, t.title as trip_title, t.slug as trip_slug,
            t.status::text as trip_status, t.depart_at,
            m.id as member_id, m.first_name, m.last_name, m.email::text as email,
            p.id as payment_id, p.status::text as payment_status, p.provider as payment_provider,
            p.reference as payment_reference, p.note as payment_note,
            coalesce(p.refunded_cents, 0) as refunded_cents,
            p.created_at as payment_created_at
       from signups s
       join trips t on t.id = s.trip_id
       join members m on m.id = s.member_id
       left join lateral (
         select id, status, provider, reference, note, refunded_cents, created_at
           from payments
          where signup_id = s.id
          -- Newest wins. A correction is recorded as a second row rather than
          -- an edit, so the latest one is the treasurer's current answer.
          order by created_at desc
          limit 1
       ) p on true
      where ($1::uuid is null or s.trip_id = $1)
        and t.archived_at is null
        -- Payment-bearing: allocated a spot, or money changed hands at some
        -- point even though the spot is gone.
        and (s.status in ('held', 'paid', 'refunded') or p.id is not null)
      order by t.depart_at, t.title, s.spot_number nulls last, s.claim_seq
      limit $2`,
    [tripId, limit],
  );
}

export function matchesPaymentFilter(
  row: PaymentLine,
  filter: PaymentFilter,
  now: number,
): boolean {
  if (filter === "all") return true;
  const state = paymentState(row, now);
  if (filter === "owing") return state === "unpaid" || state === "lapsed";
  return state === "paid";
}

/**
 * Filtering happens here rather than in SQL so the page and the CSV export
 * cannot drift, and so the lapsed rule lives in exactly one place.
 */
export function filterPaymentLines(
  rows: PaymentLine[],
  filter: PaymentFilter,
  now: number = Date.now(),
): PaymentLine[] {
  return rows.filter((row) => matchesPaymentFilter(row, filter, now));
}

export type PaidVia = { label: string; note: string | null };

/**
 * The payments row is preferred over `offline_note` because it is the one that
 * carries a reference the treasurer can look up again. Rows marked paid before
 * payments rows were written fall back to the note, and a `paid` signup with
 * neither says so plainly rather than inventing a source.
 */
export function paidVia(row: PaymentLine): PaidVia {
  if (row.payment_status === "paid" || row.payment_status === "refunded") {
    const provider = parsePaymentProvider(row.payment_provider);
    const detail = row.payment_reference?.trim() || row.payment_note?.trim() || null;
    return { label: PAYMENT_PROVIDER_LABELS[provider], note: detail };
  }
  if (row.paid_offline) return { label: "Recorded by hand", note: row.offline_note };
  if (row.signup_status === "paid") return { label: "Source not recorded", note: null };
  return { label: "-", note: null };
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export type PaymentTotals = {
  /** Owed by everyone currently allocated a spot, paid or not. */
  expected_cents: number;
  collected_cents: number;
  paid_count: number;
  unpaid_count: number;
  lapsed_count: number;
};

export async function getPaymentTotals(): Promise<PaymentTotals> {
  const rows = await execute<PaymentTotals>(
    `select
       coalesce(sum(s.amount_cents) filter (where s.status in ('held', 'paid')), 0)::int
         as expected_cents,
       coalesce(sum(s.amount_cents) filter (where s.status = 'paid'), 0)::int
         as collected_cents,
       count(*) filter (where s.status = 'paid')::int as paid_count,
       count(*) filter (where s.status = 'held' and s.payment_deadline_at > now())::int
         as unpaid_count,
       count(*) filter (where s.status = 'held' and s.payment_deadline_at <= now())::int
         as lapsed_count
     from signups s
     join trips t on t.id = s.trip_id
     where t.status in ${LIVE_TRIP_STATUSES}
       and t.archived_at is null`,
  );

  return (
    rows[0] ?? {
      expected_cents: 0,
      collected_cents: 0,
      paid_count: 0,
      unpaid_count: 0,
      lapsed_count: 0,
    }
  );
}

export function outstandingCents(totals: {
  expected_cents: number;
  collected_cents: number;
}): number {
  return Math.max(0, totals.expected_cents - totals.collected_cents);
}

// ---------------------------------------------------------------------------
// Live trips
// ---------------------------------------------------------------------------

export type LiveTrip = {
  id: string;
  title: string;
  /** Where members are sent to pay. Null until the board sets one. */
  payment_url: string | null;
};

/**
 * Scope for the reminder batch, and the only per-trip fact worth a treasurer's
 * attention: a live trip with no payment link is one whose members have nowhere
 * to pay. The rest of the per-trip money is on the trip itself.
 */
export async function listLiveTrips(): Promise<LiveTrip[]> {
  return execute<LiveTrip>(
    `select id, title, payment_url
       from trips
      where status in ${LIVE_TRIP_STATUSES}
        and archived_at is null
      order by depart_at`,
  );
}

// ---------------------------------------------------------------------------
// Trip picker
// ---------------------------------------------------------------------------

export type PaymentTripOption = {
  id: string;
  title: string;
  trip_status: TripStatus;
};

/** Every trip, not only the live ones - reconciliation happens after the fact. */
export async function listPaymentTripOptions(limit = 200): Promise<PaymentTripOption[]> {
  return execute<PaymentTripOption>(
    `select id, title, status::text as trip_status
       from trips
      where status <> 'draft'
        and archived_at is null
      order by depart_at desc
      limit $1`,
    [limit],
  );
}
