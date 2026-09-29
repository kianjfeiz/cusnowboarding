import type { PoolClient } from "pg";
import { generatePayToken } from "@/lib/claims/claim";

/**
 * The board rides free, and does not use up the trip.
 *
 *   1. A board member owes nothing. Their row is `paid` with `amount_cents`
 *      zero: no deadline, nothing for the reaper to take back.
 *   2. A board seat is not one of the spots. Capacity 25 means 25 paying
 *      riders; six of the board coming makes it a bus of 31.
 *
 * Rule 2 is the one with teeth: a board seat must touch neither `spot_number`
 * nor `trips.claim_counter` - see the `board_seat` column comment in schema.ts
 * for how the counter would quietly cost members their spots. Every occupancy
 * count filters these rows out. Nothing here emails anybody.
 */

/**
 * Whether members row `m` is on the active board. The same identity join the
 * rest of the app uses: a board member is a member who is also on the board. A
 * board user who has never signed in has no `members` row and cannot be put on
 * a roster yet - `compBoardMembers` is what catches them up.
 */
const ON_BOARD = `exists (select 1 from board_users b where b.is_active and b.email = m.email)`;

/**
 * The claim_seq a new board seat should take on this trip: negative,
 * descending, and never a value the counter could issue. `least(min, 0) - 1`
 * rather than `min - 1` so the first seat on a trip whose entrants are all
 * positive still lands at -1. The caller must pass the trip id as $1.
 */
export const NEXT_BOARD_SEQ = `
  (select coalesce(least(min(claim_seq), 0), 0) - 1
     from signups where trip_id = $1)
`;

/**
 * Gives every board member without a live signup on this trip a comped seat,
 * and returns how many were written. Called when a trip is created; whoever is
 * not coming is removed during curation, which costs no member a spot.
 *
 * Idempotent: anyone already live on the trip is skipped. The caller must hold
 * the trips row lock if anything else could be writing.
 */
export async function grantBoardSeats(
  client: PoolClient,
  tripId: string,
  boardUserId: string | null,
): Promise<number> {
  const { rows: eligible } = await client.query<{ id: string }>(
    `select m.id
       from members m
      where ${ON_BOARD}
        and not m.is_blocked
        and not exists (
          select 1 from signups s
           where s.trip_id = $1 and s.member_id = m.id
             and s.status in ('held','paid','waitlisted')
        )
      -- Deterministic, so the sequence numbers below do not depend on whatever
      -- order the join happened to emit.
      order by m.email`,
    [tripId],
  );

  if (eligible.length === 0) return 0;

  // Pay tokens are generated here rather than in SQL: the database has no
  // base64url encoder. One statement still does the write, so the sequence
  // numbers cannot interleave with another grant.
  const { rows: written } = await client.query<{ id: string }>(
    `insert into signups (
       trip_id, member_id, claim_seq, status, spot_number, waitlist_position,
       claimed_at, payment_deadline_at, paid_at, amount_cents, pay_token,
       board_seat, created_by_board_user_id
     )
     select $1, t.member_id,
            ${NEXT_BOARD_SEQ} - (t.ord - 1),
            'paid', null, null, now(), null, now(), 0, t.token, true, $4::uuid
       from unnest($2::uuid[], $3::text[]) with ordinality as t(member_id, token, ord)
     returning id`,
    [
      tripId,
      eligible.map((row) => row.id),
      eligible.map(() => generatePayToken()),
      boardUserId,
    ],
  );

  return written.length;
}

/**
 * Turns any live signup held by a board member into a comped seat. Runs inside
 * releaseResults, and catches whoever joined the board after the trip was
 * created or entered the drop by hand. Freeing their `spot_number` hands the
 * spot back to the trip.
 *
 * Only `held` and `waitlisted` rows are converted. A board member who has
 * already PAID is left alone: turning that into a comp would silently write off
 * a refund the treasurer never issued.
 */
export async function compBoardMembers(
  client: PoolClient,
  tripId: string,
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `update signups s
        set board_seat          = true,
            status              = 'paid',
            spot_number         = null,
            waitlist_position   = null,
            payment_deadline_at = null,
            paid_at             = now(),
            amount_cents        = 0,
            updated_at          = now()
      where s.trip_id = $1
        and s.status in ('held','waitlisted')
        and not s.board_seat
        and exists (select 1 from members m where m.id = s.member_id and ${ON_BOARD})
      returning s.id`,
    [tripId],
  );

  return rows.length;
}

/** Whether this member is on the board, and so rides free. */
export async function isBoardMember(
  client: PoolClient,
  memberId: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `select 1 from members m where m.id = $1 and ${ON_BOARD}`,
    [memberId],
  );
  return rows.length > 0;
}
