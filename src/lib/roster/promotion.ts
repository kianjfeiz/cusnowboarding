import type { PoolClient } from "pg";
import { execute, transaction, type pool } from "@/lib/db";
import { HOLD_GRACE_INTERVAL } from "@/lib/roster/holds";

/**
 * The trips row lock, and the board actions built on it.
 *
 * Promotion is deliberately a board action rather than an automatic one: the
 * travel coordinator often knows something the database does not (someone
 * already paid over Venmo, someone is driving). Unlike the claim, these cold
 * paths may safely use a multi-statement transaction - they run once per click,
 * not a hundred times in a burst.
 */

/** The trip columns the locked paths decide on, read by the locking select. */
export interface LockedTrip {
  status: string;
  capacity: number;
  payment_window_hours: number;
  price_cents: number;
  results_released_at: Date | null;
  /** Arrival numbers handed out so far; claims take spots while it is below capacity. */
  claim_counter: number;
}

/**
 * Runs `work` in a transaction that holds the trips row lock.
 *
 * THE ORDERING RULE: anything that moves a spot or a waitlist position takes
 * this lock first, before touching signups. Every path in the system follows it
 * - promotion, roster editing, release, reinstate, board add/release/cancel,
 * the expiry job - so concurrent board actions queue instead of deadlocking. A
 * write that skips it is what a future deadlock will be traced back to.
 *
 * `trip` is null when the trip does not exist. As with any `transaction`, a
 * result of `{ ok: false }` rolls back.
 *
 * Free riders are settled on both sides of `work`: before, so the expiry job
 * never drops someone for not paying nothing, and after, so whoever `work`
 * just put on the trip - or everyone, when `work` is the release - is settled
 * in the same transaction.
 */
export async function withTripLock<T>(
  tripId: string,
  work: (client: PoolClient, trip: LockedTrip | null) => Promise<T>,
): Promise<T> {
  return transaction(async (client) => {
    const { rows } = await client.query<LockedTrip>(
      `select status::text as status, capacity, payment_window_hours, price_cents, results_released_at,
              claim_counter::int as claim_counter
         from trips where id = $1 for update`,
      [tripId],
    );
    await settleFreeRiders(client, tripId);
    const result = await work(client, rows[0] ?? null);
    await settleFreeRiders(client, tripId);
    return result;
  });
}

/**
 * A rider owing nothing is on the trip, not held. Left held, the expiry job
 * would drop them when a deadline for $0 passed, and the attendee list and ride
 * sheet (paid riders only) would shut them out. Before release they stay held
 * like every other entrant, because nobody has been told anything yet.
 */
async function settleFreeRiders(client: PoolClient, tripId: string): Promise<void> {
  await client.query(
    `update signups s
        set status = 'paid', paid_at = now(), updated_at = now()
       from trips t
      where t.id = s.trip_id
        and s.trip_id = $1
        and s.status = 'held'
        and s.amount_cents = 0
        and t.results_released_at is not null`,
    [tripId],
  );
}

/** The audit row, written on the caller's transaction so it commits with the change. */
export async function auditInTransaction(
  client: PoolClient,
  boardUserId: string | null,
  action: string,
  entityType: "trip" | "signup",
  entityId: string,
  data: unknown,
): Promise<void> {
  await client.query(
    `insert into audit_events (actor_board_user_id, action, entity_type, entity_id, data)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [boardUserId, action, entityType, entityId, JSON.stringify(data)],
  );
}

/**
 * Lowest unoccupied spot number, so the roster stays dense. Never a count(*)
 * against capacity - that reads a snapshot and oversells. Only meaningful under
 * the trip lock, after `releaseLapsedHolds`.
 */
export async function lowestFreeSpot(
  client: PoolClient,
  tripId: string,
  capacity: number,
): Promise<number | null> {
  const { rows } = await client.query<{ spot: number }>(
    `select gs as spot
       from generate_series(1, $2) gs
      where not exists (
        select 1 from signups s
         where s.trip_id = $1 and s.spot_number = gs
      )
      order by gs
      limit 1`,
    [tripId, capacity],
  );
  return rows[0]?.spot ?? null;
}

/**
 * Where the board puts someone on the trip by hand: the lowest free spot, or -
 * capacity being a target - the next number past the last one. Numbers above
 * capacity are safe while claims are open, because the claim only ever hands
 * out spots up to capacity. Only meaningful under the trip lock.
 */
export async function nextSpot(
  client: PoolClient,
  tripId: string,
  capacity: number,
): Promise<number> {
  const free = await lowestFreeSpot(client, tripId, capacity);
  if (free !== null) return free;
  const { rows } = await client.query<{ next: number }>(
    `select greatest(coalesce(max(spot_number), 0), $2) + 1 as next
       from signups where trip_id = $1 and spot_number is not null`,
    [tripId, capacity],
  );
  return rows[0].next;
}

/**
 * The claim hands out spot `n` for every `n` up to capacity, so a spot the board
 * fills by hand must sit at or below the counter, or the next claim computes
 * that same spot and its insert is swallowed. Raising the counter only ever
 * pushes later claims higher, so it cannot cause a collision of its own.
 */
export async function keepCounterAtLeast(
  client: PoolClient,
  tripId: string,
  atLeast: number,
): Promise<void> {
  await client.query(
    `update trips set claim_counter = greatest(claim_counter, $2::int), updated_at = now()
      where id = $1`,
    [tripId, atLeast],
  );
}

/**
 * Keeps the claim statement's arithmetic collision-free after a board write
 * grows the waitlist. A claim computes waitlist_position = n - capacity from
 * claim_counter, which is only safe while every position at or below
 * (claim_counter - capacity) is one the counter handed out. A board write that
 * adds a position without consuming a counter value breaks that: the next
 * claim derives a position that already exists, `on conflict do nothing`
 * swallows its insert, and every subsequent entrant is refused the same way
 * until signups close. Pinning the counter to at least capacity + waitlist
 * length keeps derived positions above board-assigned ones. The counter may
 * gap; occupancy never reads it. Race-free only under the trip lock.
 */
export async function pinClaimCounter(
  client: PoolClient,
  tripId: string,
  waitlistLength: number,
): Promise<void> {
  await client.query(
    `update trips
        set claim_counter = greatest(claim_counter, capacity + $2::int),
            updated_at    = now()
      where id = $1`,
    [tripId, waitlistLength],
  );
}

export interface PromotionResult {
  ok: boolean;
  reason?: "not_waitlisted" | "no_free_spot" | "trip_missing";
  spotNumber?: number;
}

/**
 * Releases holds whose payment deadline has passed, freeing their spot numbers.
 *
 * Every occupancy read applies lazy expiry, but a lapsed row still physically
 * occupies its spot_number until it is released. Anything allocating a spot
 * therefore does this first, or the UI would report a free spot that nothing
 * here can assign. The grace window must match the one occupancy uses - see
 * lib/roster/holds.ts.
 *
 * A signup with a recorded payment is never reaped even if its status still
 * reads 'held': a payments row is the strongest evidence that someone paid.
 */
export async function releaseLapsedHolds(
  client: PoolClient | typeof pool,
  tripId?: string,
): Promise<Array<{ id: string; trip_id: string; member_id: string }>> {
  const { rows } = await client.query<{
    id: string;
    trip_id: string;
    member_id: string;
  }>(
    `update signups
        set status         = 'expired',
            spot_number    = null,
            released_at    = now(),
            release_reason = 'expired',
            updated_at     = now()
      where status = 'held'
        and payment_deadline_at <= now() - ${HOLD_GRACE_INTERVAL}
        ${tripId ? "and trip_id = $1" : ""}
        -- Never reap a spot on a trip whose results are still unpublished. The
        -- member has not been told they have it, so the deadline they are being
        -- measured against is one they could not have acted on.
        and exists (
          select 1 from trips t
           where t.id = signups.trip_id and t.results_released_at is not null
             -- An archived trip is out of the running: reaping its spots would
             -- email members about a trip that no longer appears anywhere.
             and t.archived_at is null
        )
        and not exists (
          select 1 from payments p
           where p.signup_id = signups.id and p.status = 'paid'
        )
      returning id, trip_id, member_id`,
    tripId ? [tripId] : [],
  );

  return rows;
}

/**
 * Renumbers the live waitlist to be contiguous from 1, keeping the order the
 * rows already have. Position, not claim_seq, is the ordering source: ordering
 * by arrival here would silently undo the board's curation at the first
 * promotion or cancel. Arrival order is only the tiebreak.
 *
 * Done in two passes through a high offset range. The partial unique index on
 * (trip_id, waitlist_position) is checked per row rather than at statement end,
 * so shifting positions in a single UPDATE can collide with itself. Moving
 * everything out of the way first makes the operation order-independent.
 */
export async function renumberWaitlist(client: PoolClient, tripId: string): Promise<void> {
  const OFFSET = 1_000_000;

  await client.query(
    `update signups
        set waitlist_position = waitlist_position + $2
      where trip_id = $1 and status = 'waitlisted' and waitlist_position is not null`,
    [tripId, OFFSET],
  );

  await client.query(
    `with ordered as (
       select id, row_number() over (order by waitlist_position asc nulls last, claim_seq) as pos
         from signups
        where trip_id = $1 and status = 'waitlisted'
     )
     update signups s
        set waitlist_position = o.pos::int
       from ordered o
      where s.id = o.id`,
    [tripId],
  );
}

export async function promoteFromWaitlist(
  signupId: string,
  boardUserId: string | null,
): Promise<PromotionResult> {
  // Read before the lock only to learn which trip to lock. The guarded UPDATE
  // below re-checks the status once the lock is held.
  const [signup] = await execute<{ trip_id: string }>(
    `select trip_id from signups where id = $1 and status = 'waitlisted'`,
    [signupId],
  );
  if (!signup) return { ok: false, reason: "not_waitlisted" };
  const tripId = signup.trip_id;

  // The lock serialises concurrent promotions: two coordinators clicking
  // Promote at once must not be handed the same spot number.
  return withTripLock<PromotionResult>(tripId, async (client, trip) => {
    if (!trip) return { ok: false, reason: "trip_missing" };

    await releaseLapsedHolds(client, tripId);

    const spot = await lowestFreeSpot(client, tripId, trip.capacity);
    if (spot === null) return { ok: false, reason: "no_free_spot" };

    const promoted = await client.query(
      `update signups
          set status              = 'held',
              spot_number         = $3,
              waitlist_position   = null,
              payment_deadline_at = now() + make_interval(hours => $4::int),
              promoted_at         = now(),
              promoted_by         = $5,
              updated_at          = now()
        where id = $1 and trip_id = $2 and status = 'waitlisted'`,
      [signupId, tripId, spot, trip.payment_window_hours, boardUserId],
    );
    if (promoted.rowCount === 0) return { ok: false, reason: "not_waitlisted" };

    await renumberWaitlist(client, tripId);

    // Promotion is a manual judgement call, so it needs a defensible record.
    await auditInTransaction(client, boardUserId, "signup.promote", "signup", signupId, {
      tripId,
      spotNumber: spot,
    });

    return { ok: true, spotNumber: spot };
  });
}
