import { randomBytes } from "node:crypto";
import type { SignupStatus } from "@/lib/db/schema";

/**
 * A minimal query interface so the claim can run against the app pool, a
 * dedicated test client, or a Neon HTTP handle without knowing which.
 */
export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export type ClaimOutcome =
  | "held"
  | "waitlisted"
  | "duplicate"
  | "not_open"
  | "unverified"
  | "not_member"
  | "full"
  | "error";

export interface ClaimedSignup {
  id: string;
  claimSeq: number;
  status: SignupStatus;
  spotNumber: number | null;
  waitlistPosition: number | null;
  paymentDeadlineAt: Date | null;
  payToken: string;
  amountCents: number;
  claimedAt: Date;
}

/**
 * `consumedSeq` is set when a counter value was issued but no row resulted -
 * the sequence-gap case. The caller should hand it to `releaseUnusedSequence`
 * off the response path.
 */
export type ClaimResult =
  | { outcome: "held" | "waitlisted"; signup: ClaimedSignup; consumedSeq?: number }
  | { outcome: "duplicate"; signup: ClaimedSignup | null; consumedSeq?: number }
  | {
      outcome: "not_open" | "unverified" | "not_member" | "full" | "error";
      signup?: undefined;
      consumedSeq?: number;
    };

/**
 * THE CLAIM.
 *
 * One statement, one implicit transaction, one network round trip. Everything
 * about drop-night fairness rests on this, so the reasoning is worth stating
 * plainly:
 *
 * 1. `update trips ... set claim_counter = claim_counter + 1` IS the lock.
 *    Concurrent claimers for the same trip queue on that row's exclusive lock
 *    and are handed distinct, strictly increasing values of `n` in the order
 *    Postgres granted them the lock. That order is the true server arrival
 *    order - no client clock, retry loop, or script can influence it.
 *
 * 2. Capacity is decided by arithmetic on `n`, not by counting rows.
 *    `n <= capacity` wins a spot; anything above goes to the waitlist at
 *    position `n - capacity`. Because the `n` values are distinct, at most
 *    `capacity` claimers can ever be issued a spot. This is why the statement
 *    does NOT contain a `count(*)` capacity check - see the note below.
 *
 * 3. The `not exists` duplicate check is an OPTIMISATION, not the guarantee.
 *    Like any subquery it reads the statement snapshot, so two genuinely
 *    simultaneous clicks from one member can both pass it. The real guarantee
 *    is the partial unique index `signups_one_active_per_member` combined with
 *    `on conflict do nothing`: the second insert is silently dropped. Do not
 *    remove either the index or the `on conflict` clause.
 *
 * WHY NOT `count(*)`: a capacity check of the form
 *   `where (select count(*) from signups where trip_id = $1) < capacity`
 * is broken under READ COMMITTED. The subquery reads a snapshot, so fifty
 * concurrent statements all observe `24 < 25` and all insert. That is classic
 * write skew, and `tests/isolation.test.ts` demonstrates it overselling on
 * purpose so nobody "simplifies" this statement into it later.
 *
 * KNOWN CAVEAT - sequence gaps: when the duplicate check is beaten (point 3),
 * a counter value is consumed with no row behind it, so a capacity-25 trip can
 * fill only 24 spots. `releaseUnusedSequence` compensates off the response
 * path, and every roster view computes free spots from actual rows rather than
 * from the counter, so a stranded spot simply surfaces as "1 spot open" for
 * the board's existing manual promotion flow.
 *
 * The statement ends in a plain SELECT over both data-modifying CTEs rather
 * than returning straight from the INSERT. That costs nothing and means a
 * swallowed insert still tells us which counter value it burned, which is the
 * only way compensation can know what to give back.
 */
const CLAIM_SQL = `
with
member_ok as (
  select m.id
    from members m
   where m.id = $2
     and m.email_verified_at is not null
     and m.is_blocked = false
     -- Token version is checked here rather than before the statement so that
     -- revoking a member's cookie costs no extra round trip at drop time.
     and ($4::int is null or m.token_version = $4)
),
trip_open as (
  select t.id
    from trips t
   where t.id = $1
     and t.status = 'open'
     and t.signup_opens_at <= now()
     and (t.signup_closes_at is null or t.signup_closes_at > now())
     and (
       t.requires_dues = false
       or exists (select 1 from members m where m.id = $2 and m.is_club_member)
     )
),
seq as (
  update trips t
     set claim_counter = t.claim_counter + 1,
         updated_at    = now()
   where t.id = (select id from trip_open)
     and exists (select 1 from member_ok)
     and not exists (
           select 1
             from signups s
            where s.trip_id  = $1
              and s.member_id = $2
              and s.status in ('held','paid','waitlisted')
         )
     and (
           t.waitlist_cap is null
           or t.claim_counter < t.capacity + t.waitlist_cap
         )
  returning t.claim_counter as n,
            t.capacity,
            t.payment_window_hours,
            t.price_cents
),
ins as (
  insert into signups (
    trip_id, member_id, claim_seq, status, spot_number, waitlist_position,
    claimed_at, payment_deadline_at, amount_cents, pay_token
  )
  select
    $1::uuid,
    $2::uuid,
    seq.n,
    (case when seq.n <= seq.capacity then 'held' else 'waitlisted' end)::signup_status,
    (case when seq.n <= seq.capacity then seq.n end)::int,
    (case when seq.n >  seq.capacity then seq.n - seq.capacity end)::int,
    now(),
    (case when seq.n <= seq.capacity
          then now() + make_interval(hours => seq.payment_window_hours) end),
    seq.price_cents,
    $3
  from seq
  on conflict do nothing
  returning id, claim_seq, status, spot_number, waitlist_position,
            payment_deadline_at, pay_token, amount_cents, claimed_at
)
select
  (select n::bigint from seq) as consumed_seq,
  (select row_to_json(i) from ins i) as signup;
`;

// Declared as a type alias rather than an interface so it picks up an implicit
// index signature and satisfies the Queryable row constraint.
type ClaimRow = {
  id: string;
  claim_seq: string | number;
  status: SignupStatus;
  spot_number: number | null;
  waitlist_position: number | null;
  payment_deadline_at: Date | string | null;
  pay_token: string;
  amount_cents: number;
  claimed_at: Date | string;
};

/** row_to_json renders timestamps as strings, so parse defensively. */
function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function toSignup(row: ClaimRow): ClaimedSignup {
  return {
    id: row.id,
    claimSeq: Number(row.claim_seq),
    status: row.status,
    spotNumber: row.spot_number,
    waitlistPosition: row.waitlist_position,
    paymentDeadlineAt: toDate(row.payment_deadline_at),
    payToken: row.pay_token,
    amountCents: row.amount_cents,
    claimedAt: toDate(row.claimed_at)!,
  };
}

export function generatePayToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Attempt to claim a spot. Returns the outcome; never throws for ordinary
 * rejections (closed trip, unverified member, duplicate), only for genuine
 * infrastructure failures.
 */
export async function claimSpot(
  q: Queryable,
  tripId: string,
  memberId: string,
  payToken: string = generatePayToken(),
  tokenVersion: number | null = null,
): Promise<ClaimResult> {
  const { rows } = await q.query<{
    consumed_seq: string | number | null;
    signup: ClaimRow | null;
  }>(CLAIM_SQL, [tripId, memberId, payToken, tokenVersion]);

  const row = rows[0];
  const consumedSeq = row?.consumed_seq == null ? undefined : Number(row.consumed_seq);

  if (row?.signup) {
    const signup = toSignup(row.signup);
    return { outcome: signup.status === "held" ? "held" : "waitlisted", signup };
  }

  // Cold path. Losing a claim does not need to be fast, so a second query to
  // explain why is fine here and keeps the hot statement free of diagnostics.
  const failure = await diagnoseFailedClaim(q, tripId, memberId, tokenVersion);
  return consumedSeq === undefined ? failure : { ...failure, consumedSeq };
}

const DIAGNOSE_SQL = `
select
  (select count(*) from members m
    where m.id = $2
      and m.email_verified_at is not null
      and m.is_blocked = false
      -- Mirrors member_ok in the claim statement exactly. A revoked cookie must
      -- be reported as "verify again", not as a generic error.
      and ($3::int is null or m.token_version = $3)
  )::int as member_ok,
  (select count(*) from members m
    where m.id = $2 and m.is_club_member
  )::int as is_club_member,
  (select count(*) from trips t
    where t.id = $1
      and t.status = 'open'
      and t.signup_opens_at <= now()
      and (t.signup_closes_at is null or t.signup_closes_at > now())
  )::int as trip_open,
  (select t.requires_dues from trips t where t.id = $1) as requires_dues,
  (select t.waitlist_cap is not null and t.claim_counter >= t.capacity + t.waitlist_cap
     from trips t where t.id = $1
  ) as waitlist_full,
  (select row_to_json(x) from (
      select s.id, s.claim_seq, s.status, s.spot_number, s.waitlist_position,
             s.payment_deadline_at, s.pay_token, s.amount_cents, s.claimed_at
        from signups s
       where s.trip_id = $1 and s.member_id = $2
         and s.status in ('held','paid','waitlisted')
       limit 1
  ) x) as existing;
`;

async function diagnoseFailedClaim(
  q: Queryable,
  tripId: string,
  memberId: string,
  tokenVersion: number | null,
): Promise<ClaimResult> {
  const { rows } = await q.query<{
    member_ok: number;
    is_club_member: number;
    trip_open: number;
    requires_dues: boolean | null;
    waitlist_full: boolean | null;
    existing: ClaimRow | null;
  }>(DIAGNOSE_SQL, [tripId, memberId, tokenVersion]);

  const d = rows[0];
  if (!d) return { outcome: "error" };

  // Session validity is checked before anything else, so a revoked or stale
  // cookie is never answered with the member's signup details.
  if (!d.member_ok) return { outcome: "unverified" };

  // A member who already holds a spot should be shown it rather than an error,
  // whatever else is true about the trip.
  if (d.existing) {
    return { outcome: "duplicate", signup: toSignup(d.existing) };
  }

  if (!d.trip_open) return { outcome: "not_open" };
  if (d.requires_dues && !d.is_club_member) return { outcome: "not_member" };
  if (d.waitlist_full) return { outcome: "full" };

  return { outcome: "error" };
}

/**
 * Compensating decrement for a counter value that was consumed without
 * producing a signup row (see the sequence-gap caveat above).
 *
 * Safe because the `claim_counter = $2` predicate is re-checked after the row
 * lock is acquired: it only fires if this claim was still the most recent
 * incrementer. Otherwise it is a no-op and the gap is simply accepted.
 *
 * Call this off the response path - it must never delay a claimer.
 */
export async function releaseUnusedSequence(
  q: Queryable,
  tripId: string,
  consumedSeq: number,
): Promise<boolean> {
  const { rows } = await q.query<{ id: string }>(
    `update trips
        set claim_counter = claim_counter - 1
      where id = $1 and claim_counter = $2
      returning id`,
    [tripId, consumedSeq],
  );
  return rows.length > 0;
}
