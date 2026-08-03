import type { PoolClient } from "pg";
import { generatePayToken } from "@/lib/claims/claim";

/**
 * The board rides free, and does not use up the trip.
 *
 * Two rules, and everything here follows from them:
 *
 *   1. A board member owes nothing. Their row is `paid` with `amount_cents`
 *      zero, so it is settled the moment it exists - no deadline, no reminder,
 *      nothing for the reaper to take back, and no invoice for a seat that was
 *      never for sale.
 *   2. A board seat is not one of the spots. Capacity 25 means 25 paying
 *      riders; six of the board coming makes it a bus of 31, not a trip that
 *      sold out at 19.
 *
 * Rule 2 is the one with teeth. It means a board seat must touch neither
 * `spot_number` nor `trips.claim_counter` - see the `board_seat` column comment
 * in schema.ts for why the counter in particular would quietly cost members
 * their spots. Every occupancy count in the app filters these rows out, and the
 * database shape (null spot number, negative claim_seq) is what makes an
 * unfiltered count wrong in an obvious direction rather than a subtle one.
 *
 * Nothing here emails anybody. The board is told about its own trips in the
 * meeting where they are planned; a mailbox full of "you are on the trip" for
 * every drop they organised is noise, not news.
 *
 * Board membership is resolved through `members.email = board_users.email`,
 * which is the same identity join the rest of the app uses: a board member is a
 * member who also happens to be on the board, not a separate kind of account.
 * A board user who has never signed in has no `members` row and therefore
 * cannot be put on a roster yet - `compBoardMembers` is what catches them up.
 */

/**
 * The claim_seq a new board seat should take on this trip.
 *
 * Negative, descending, and never a value the counter could issue. Written as
 * `least(min(claim_seq), 0) - 1` rather than `min - 1` so the first seat on a
 * trip whose entrants are all positive still lands at -1 instead of 0.
 *
 * Takes the trip id as its only parameter, so a caller interpolating it must
 * pass the trip id as $1.
 */
export const NEXT_BOARD_SEQ = `
  (select coalesce(least(min(claim_seq), 0), 0) - 1
     from signups where trip_id = $1)
`;

/**
 * Gives every board member without a live signup on this trip a comped seat.
 *
 * Called when a trip is created, so the board is on the roster from the moment
 * it exists rather than by anyone remembering. Whoever is not actually coming
 * is removed during the curation window - which costs no member a spot, since
 * these seats were never part of the count.
 *
 * Idempotent: a board member who already holds a spot, sits on the waitlist, or
 * has a seat is skipped, so re-running only ever tops the list up. The caller
 * must hold the trips row lock if anything else could be writing.
 *
 * Returns how many seats were written.
 */
export async function grantBoardSeats(
  client: PoolClient,
  tripId: string,
  boardUserId: string | null,
): Promise<number> {
  const { rows: eligible } = await client.query<{ id: string }>(
    `select m.id
       from board_users b
       join members m on m.email = b.email
      where b.is_active
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

  /*
    Pay tokens are generated here rather than in SQL: the database has no
    base64url encoder, and a token carrying '/' or '+' would break the /pay/
    URL it exists to form. One statement still does the write, so the whole
    grant is atomic and the sequence numbers cannot interleave with another.
  */
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
 * Turns any live signup held by a board member into a comped seat.
 *
 * Runs inside releaseResults, because "the board is on the roster for free
 * before it goes out" has to be true of the roster that actually goes out - not
 * only of the one created weeks earlier. It catches the two ways a board member
 * ends up paying for a seat they should not: somebody joined the board after
 * the trip was created, or a board member who had never signed in at creation
 * time did so and entered the drop like anybody else.
 *
 * Only `held` and `waitlisted` rows are converted. A board member who has
 * already PAID is left alone: money changed hands, and turning that into a comp
 * would silently write off a refund the treasurer never issued.
 *
 * Freeing their `spot_number` is the point of the exercise - it hands the spot
 * back to the trip, where promotion can give it to a member on the waitlist.
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
        and exists (
          select 1 from board_users b
            join members m on m.email = b.email
           where b.is_active and m.id = s.member_id
        )
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
    `select 1
       from board_users b
       join members m on m.email = b.email
      where b.is_active and m.id = $1
      limit 1`,
    [memberId],
  );
  return rows.length > 0;
}
