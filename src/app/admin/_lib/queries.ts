import { execute } from "@/lib/db";
import type { TripStatus } from "@/lib/db/schema";
import { HOLD_GRACE_INTERVAL, HOLD_GRACE_MINUTES } from "@/lib/holds";

/**
 * Read models for the admin.
 *
 * The rule that matters here: occupancy is derived from signup rows, never from
 * `trips.claim_counter`. The counter assigns arrival order and is allowed to
 * contain gaps, and a hold past its payment deadline is treated as lapsed on
 * read whether or not the release cron has run. Both of those mean the board
 * sees the real number of free spots at all times.
 */

export type TripRow = {
  id: string;
  slug: string;
  title: string;
  resort: string | null;
  status: TripStatus;
  capacity: number;
  waitlist_cap: number | null;
  price_cents: number;
  payment_window_hours: number;
  requires_dues: boolean;
  /** Where members are sent to pay. Null falls back to the club-wide link. */
  payment_url: string | null;
  description: string | null;
  depart_at: Date;
  return_at: Date | null;
  signup_opens_at: Date;
  signup_closes_at: Date | null;
  claim_counter: number;
  /** Non-null once the board opens the attendee list and photo pool to members. */
  roster_finalized_at: Date | null;
  /** Non-null once outcomes have been published; members see nothing before. */
  results_released_at: Date | null;
};

export type TripSummary = TripRow & {
  paid: number;
  held: number;
  /** Holds whose deadline has already passed - a spot the board can reclaim. */
  lapsed: number;
  waitlisted: number;
  /**
   * Every signup row regardless of status, which the others deliberately are
   * not - they filter to the live ones. This is the number that decides
   * whether a trip may be deleted, because an expired or cancelled signup is
   * still a person who entered and still a row a delete would take with it.
   */
  signups: number;
};

export interface Occupancy {
  taken: number;
  free: number;
}

export function occupancyOf(trip: TripSummary): Occupancy {
  const taken = trip.paid + trip.held;
  return { taken, free: Math.max(0, trip.capacity - taken) };
}

const TRIP_COLUMNS = `
  t.id, t.slug, t.title, t.resort, t.status::text as status, t.capacity,
  t.waitlist_cap, t.price_cents, t.payment_window_hours, t.requires_dues, t.payment_url,
  t.description, t.depart_at, t.return_at, t.signup_opens_at, t.signup_closes_at,
  t.claim_counter::int as claim_counter, t.roster_finalized_at,
  t.results_released_at
`;

const TRIP_COUNTS = `
  left join lateral (
    select
      count(*) filter (where s.status = 'paid')::int as paid,
      -- The grace window must match the reaper's, or the roster advertises a
      -- free spot that promotion will refuse to fill for another ten minutes.
      count(*) filter (where s.status = 'held'
                         and s.payment_deadline_at > now() - ${HOLD_GRACE_INTERVAL})::int as held,
      count(*) filter (where s.status = 'held'
                         and s.payment_deadline_at <= now() - ${HOLD_GRACE_INTERVAL})::int as lapsed,
      count(*) filter (where s.status = 'waitlisted')::int as waitlisted,
      count(*)::int as signups
    from signups s
    where s.trip_id = t.id
  ) c on true
`;

export async function listTrips(): Promise<TripSummary[]> {
  return execute<TripSummary>(
    `select ${TRIP_COLUMNS}, c.paid, c.held, c.lapsed, c.waitlisted, c.signups
       from trips t
       ${TRIP_COUNTS}
      order by t.signup_opens_at desc`,
  );
}

export async function getTripSummary(id: string): Promise<TripSummary | null> {
  const rows = await execute<TripSummary>(
    `select ${TRIP_COLUMNS}, c.paid, c.held, c.lapsed, c.waitlisted, c.signups
       from trips t
       ${TRIP_COUNTS}
      where t.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export type RosterRow = {
  id: string;
  claim_seq: number;
  status: string;
  spot_number: number | null;
  waitlist_position: number | null;
  claimed_at: Date;
  payment_deadline_at: Date | null;
  paid_at: Date | null;
  amount_cents: number;
  paid_offline: boolean;
  offline_note: string | null;
  promoted_at: Date | null;
  member_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  is_club_member: boolean;
  payment_status: string | null;
  /** How the money arrived, from the recorded payment. Null if none recorded. */
  payment_provider: string | null;
  payment_reference: string | null;
};

export async function getRoster(tripId: string): Promise<RosterRow[]> {
  return execute<RosterRow>(
    `select s.id, s.claim_seq::int as claim_seq, s.status::text as status,
            s.spot_number, s.waitlist_position, s.claimed_at, s.payment_deadline_at,
            s.paid_at, s.amount_cents, s.paid_offline, s.offline_note, s.promoted_at,
            m.id as member_id, m.first_name, m.last_name, m.email::text as email,
            m.phone, m.is_club_member,
            p.status::text as payment_status, p.provider as payment_provider,
            p.reference as payment_reference
       from signups s
       join members m on m.id = s.member_id
       left join lateral (
         select status, provider, reference
           from payments
          where signup_id = s.id
          order by created_at desc
          limit 1
       ) p on true
      where s.trip_id = $1
      order by s.claim_seq`,
    [tripId],
  );
}

/**
 * What the row means right now. A `held` row past its deadline is reported as
 * lapsed even though the column still says held - the cron has not caught up,
 * but the spot is not really occupied.
 */
export type EffectiveStatus =
  | "paid"
  | "held"
  | "lapsed"
  | "waitlisted"
  | "expired"
  | "cancelled"
  | "refunded";

export function effectiveStatus(row: RosterRow, now: number = Date.now()): EffectiveStatus {
  if (row.status === "held") {
    const deadline = row.payment_deadline_at ? new Date(row.payment_deadline_at).getTime() : null;
    // Same grace as the reaper and the occupancy counts. A hold shows as
    // "lapsed" only once its spot is genuinely reclaimable, so the roster and
    // the Promote button never disagree.
    if (deadline !== null && deadline <= now - HOLD_GRACE_MINUTES * 60_000) return "lapsed";
    return "held";
  }
  return row.status as EffectiveStatus;
}

export const STATUS_LABELS: Record<EffectiveStatus, string> = {
  paid: "Paid",
  held: "Holding",
  lapsed: "Hold lapsed",
  waitlisted: "Waitlisted",
  expired: "Released",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export type UnpaidHold = {
  signup_id: string;
  trip_id: string;
  trip_title: string;
  spot_number: number | null;
  payment_deadline_at: Date;
  amount_cents: number;
  first_name: string;
  last_name: string;
  email: string;
};

export async function listUnpaidHolds(limit = 40): Promise<UnpaidHold[]> {
  return execute<UnpaidHold>(
    `select s.id as signup_id, t.id as trip_id, t.title as trip_title,
            s.spot_number, s.payment_deadline_at, s.amount_cents,
            m.first_name, m.last_name, m.email::text as email
       from signups s
       join trips t on t.id = s.trip_id
       join members m on m.id = s.member_id
      where s.status = 'held'
        and t.status in ('scheduled', 'open', 'closed')
      order by s.payment_deadline_at asc
      limit $1`,
    [limit],
  );
}

export type ReviewPayment = {
  id: string;
  signup_id: string;
  trip_id: string;
  trip_title: string;
  amount_cents: number;
  created_at: Date;
  email: string;
};

/**
 * Payments recorded against a spot the member no longer holds.
 *
 * Nothing sets a flag for this any more - money is recorded by hand, and there
 * is no webhook to deliver it late - but the state is still reachable: a
 * treasurer records a payment, then the spot is released or cancelled
 * afterwards. Detecting it by comparing the payment against the signup's
 * current status means it cannot be missed just because nobody remembered to
 * raise a flag. The club is holding money against a spot nobody has.
 */
export async function listPaymentsNeedingReview(limit = 20): Promise<ReviewPayment[]> {
  return execute<ReviewPayment>(
    `select p.id, p.signup_id, t.id as trip_id, t.title as trip_title,
            p.amount_cents, p.created_at, m.email::text as email
       from payments p
       join signups s on s.id = p.signup_id
       join trips t on t.id = s.trip_id
       join members m on m.id = s.member_id
      where p.status = 'paid'
        and s.status in ('expired','cancelled')
      order by p.created_at desc
      limit $1`,
    [limit],
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export type MemberRow = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email_verified_at: Date | null;
  is_club_member: boolean;
  is_blocked: boolean;
  created_at: Date;
  trip_count: number;
  paid_count: number;
  trip_titles: string | null;
};

export async function listMembers(search: string, limit = 100): Promise<MemberRow[]> {
  return execute<MemberRow>(
    `select m.id, m.email::text as email, m.first_name, m.last_name, m.phone,
            m.email_verified_at, m.is_club_member, m.is_blocked, m.created_at,
            coalesce(h.trip_count, 0) as trip_count,
            coalesce(h.paid_count, 0) as paid_count,
            h.trip_titles
       from members m
       left join lateral (
         select count(*)::int as trip_count,
                count(*) filter (where s.status = 'paid')::int as paid_count,
                string_agg(t.title, ', ' order by t.depart_at desc) as trip_titles
           from signups s
           join trips t on t.id = s.trip_id
          where s.member_id = m.id
            and s.status in ('held', 'paid', 'waitlisted')
       ) h on true
      where $1::text = ''
         or m.email::text ilike '%' || $1 || '%'
         or (m.first_name || ' ' || m.last_name) ilike '%' || $1 || '%'
      order by m.created_at desc
      limit $2`,
    [search, limit],
  );
}

// ---------------------------------------------------------------------------
// Board users
// ---------------------------------------------------------------------------

export type BoardUserRow = {
  id: string;
  email: string;
  name: string | null;
  is_active: boolean;
  is_superadmin: boolean;
  last_login_at: Date | null;
  created_at: Date;
  roles: Array<{ key: string; termYear: number }>;
};

export async function listBoardUsers(): Promise<BoardUserRow[]> {
  return execute<BoardUserRow>(
    `select b.id, b.email::text as email, b.name, b.is_active, b.is_superadmin,
            b.last_login_at, b.created_at,
            coalesce(
              json_agg(json_build_object('key', ur.role_key, 'termYear', ur.term_year)
                       order by ur.term_year desc, ur.role_key)
                filter (where ur.role_key is not null),
              '[]'
            ) as roles
       from board_users b
       left join board_user_roles ur on ur.board_user_id = b.id
      group by b.id
      order by b.is_active desc, b.created_at`,
  );
}

export type BoardRoleRow = { key: string; label: string; sort: number };

export async function listBoardRoles(): Promise<BoardRoleRow[]> {
  return execute<BoardRoleRow>(`select key, label, sort from board_roles order by sort`);
}

// ---------------------------------------------------------------------------
// Drop log
// ---------------------------------------------------------------------------

export type ClaimAttemptRow = {
  id: number;
  result: string;
  claim_seq: number | null;
  email: string | null;
  member_id: string | null;
  member_name: string | null;
  ip: string | null;
  user_agent: string | null;
  latency_ms: number | null;
  at_denver: string;
  at_utc: string;
};

export async function listClaimAttempts(tripId: string, limit = 500) {
  // The claim route logs member_id only - resolving an address there would mean
  // another query on the drop-time path, which is exactly what that route is
  // built to avoid. The join belongs here, where nobody is racing.
  return execute<ClaimAttemptRow>(
    `select a.id, a.result, a.claim_seq::int as claim_seq,
            coalesce(a.email::text, m.email::text) as email,
            a.member_id,
            case when m.id is null then null
                 else m.first_name || ' ' || m.last_name end as member_name,
            host(a.ip) as ip, a.user_agent, a.latency_ms,
            to_char(a.created_at at time zone 'America/Denver', 'YYYY-MM-DD HH24:MI:SS.MS') as at_denver,
            to_char(a.created_at at time zone 'UTC', 'HH24:MI:SS.MS') as at_utc
       from claim_attempts a
       left join members m on m.id = a.member_id
      where a.trip_id = $1
      order by a.created_at asc, a.id asc
      limit $2`,
    [tripId, limit],
  );
}
