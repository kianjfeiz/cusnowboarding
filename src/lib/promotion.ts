import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { HOLD_GRACE_INTERVAL } from "@/lib/holds";

/**
 * Waitlist promotion.
 *
 * Deliberately a board action rather than an automatic one: the travel
 * coordinator often knows something the database does not (someone already
 * paid over Venmo, someone is driving, a rider dropped for a reason worth
 * honouring). So this is a short explicit transaction on the cold path, not
 * part of the claim statement.
 *
 * Unlike the claim, this may safely use a multi-statement transaction - it
 * runs once per promotion, not a hundred times in a burst.
 */

/**
 * Runs `work` in a transaction that holds the trips row lock.
 *
 * THE ORDERING RULE: anything that moves a spot or a waitlist position takes
 * this lock first, before touching signups. Every path in the system follows it
 * - promoteFromWaitlist, applyRosterAssignment, releaseResults, reinstate - so
 * concurrent board actions queue instead of deadlocking. A write that skips it
 * is not obviously broken today, but it is what a future deadlock will be
 * traced back to.
 */
export async function withTripLock<T>(
  tripId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select id from trips where id = $1 for update`, [tripId]);
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface PromotionResult {
  ok: boolean;
  reason?: "not_waitlisted" | "no_free_spot" | "trip_missing";
  signupId?: string;
  spotNumber?: number;
  paymentDeadlineAt?: Date;
  memberEmail?: string;
  memberName?: string;
}

/**
 * Releases holds whose payment deadline has passed, freeing their spot numbers.
 *
 * Everything that reads occupancy applies lazy expiry (a lapsed hold does not
 * count as taken), but a lapsed row still physically occupies its spot_number
 * until it is released. Promotion therefore has to do this first, or it would
 * see "one spot free" in the UI and find nothing assignable here.
 *
 * The grace window exists so the reaper cannot beat a payment the treasurer is
 * in the middle of recording. The same grace is applied wherever occupancy is
 * computed - see lib/holds.ts for why they must agree.
 *
 * A signup with a recorded payment is never reaped even if its own status
 * somehow still reads 'held'. Money is settled outside this app, so a payments
 * row is the strongest evidence available that someone actually paid, and
 * releasing their spot would be the single worst thing this job could do.
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
 * Renumbers the live waitlist to be contiguous from 1, ordered by arrival.
 *
 * Done in two passes through a high offset range. The partial unique index on
 * (trip_id, waitlist_position) is checked per row rather than at statement end,
 * so shifting positions down in a single UPDATE can trip over itself depending
 * on the order rows happen to be processed. Moving everything out of the way
 * first makes the operation order-independent.
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
       select id, row_number() over (order by claim_seq) as pos
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
  const client = await pool.connect();

  try {
    await client.query("begin");

    const { rows: signupRows } = await client.query<{ trip_id: string }>(
      `select trip_id from signups where id = $1 and status = 'waitlisted'`,
      [signupId],
    );
    if (signupRows.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "not_waitlisted" };
    }
    const tripId = signupRows[0].trip_id;

    // Serialises concurrent promotions on the same trip. Two coordinators
    // clicking Promote at once must not be handed the same spot number.
    const { rows: tripRows } = await client.query<{
      capacity: number;
      payment_window_hours: number;
    }>(`select capacity, payment_window_hours from trips where id = $1 for update`, [tripId]);

    if (tripRows.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "trip_missing" };
    }
    const { capacity, payment_window_hours: windowHours } = tripRows[0];

    await releaseLapsedHolds(client, tripId);

    // Lowest unoccupied spot number, so the roster stays dense.
    const { rows: freeRows } = await client.query<{ spot: number }>(
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

    if (freeRows.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "no_free_spot" };
    }
    const spot = freeRows[0].spot;

    const { rows: promoted } = await client.query<{
      id: string;
      spot_number: number;
      payment_deadline_at: Date;
      email: string;
      first_name: string;
      last_name: string;
    }>(
      `update signups s
          set status              = 'held',
              spot_number         = $3,
              waitlist_position   = null,
              payment_deadline_at = now() + make_interval(hours => $4::int),
              promoted_at         = now(),
              promoted_by         = $5,
              updated_at          = now()
        from members m
       where s.id = $1 and s.trip_id = $2 and s.status = 'waitlisted'
         and m.id = s.member_id
       returning s.id, s.spot_number, s.payment_deadline_at,
                 m.email, m.first_name, m.last_name`,
      [signupId, tripId, spot, windowHours, boardUserId],
    );

    if (promoted.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "not_waitlisted" };
    }

    await renumberWaitlist(client, tripId);

    // Promotion is a manual judgement call, so it needs a defensible record.
    await client.query(
      `insert into audit_events (actor_board_user_id, action, entity_type, entity_id, data)
       values ($1, 'signup.promote', 'signup', $2, $3::jsonb)`,
      [boardUserId, signupId, JSON.stringify({ tripId, spotNumber: spot })],
    );

    await client.query("commit");

    const row = promoted[0];
    return {
      ok: true,
      signupId: row.id,
      spotNumber: row.spot_number,
      paymentDeadlineAt: row.payment_deadline_at,
      memberEmail: row.email,
      memberName: `${row.first_name} ${row.last_name}`,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
