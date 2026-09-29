import { isBoardMember, NEXT_BOARD_SEQ } from "@/lib/roster/board-seats";
import { generatePayToken } from "@/lib/claims/claim";
import {
  auditInTransaction,
  keepCounterAtLeast,
  nextSpot,
  pinClaimCounter,
  releaseLapsedHolds,
  withTripLock,
} from "@/lib/roster/promotion";

/**
 * Putting someone on a trip who did not win the spot themselves - the ordinary
 * case after results go out, when a rider who never entered takes the seat of
 * one who dropped. The third sibling of promotion and reinstate: cold path, one
 * transaction, same lock order.
 *
 * Two shapes of write, decided by what the member already has on this trip:
 *
 *   - A dead row (expired, cancelled, refunded) is REVIVED. The member entered
 *     once and their `claim_seq` is the record of when; a second row would
 *     leave the drop log claiming they entered twice.
 *   - Otherwise a new row is inserted, taking the next `claim_counter` value so
 *     its arrival order reads as what it is: after everyone who raced for it.
 *
 * `created_by_board_user_id` is what separates an added spot from a won one on
 * the roster later.
 */

export type RosterAddFailure =
  | "trip_missing"
  | "member_missing"
  | "member_blocked"
  /** They already hold a spot or sit on the waitlist for this trip. */
  | "already_active"
  /** Every spot number is taken; the waitlist is the only place left. */
  | "no_free_spot"
  /**
   * The waitlist was asked for while the drop can still hand out spots: a
   * board-placed position would collide with one a later claim derives from
   * the counter. The trip itself is the place for them then.
   */
  | "spots_open";

export type RosterAddDestination = "trip" | "waitlist";

export type RosterAddResult =
  | {
      ok: true;
      signupId: string;
      /** True when an existing released or cancelled row came back. */
      revived: boolean;
      status: "held" | "waitlisted" | "board";
      /** True when the member is on the board, so they were comped whatever the caller asked for. */
      boardSeat: boolean;
      spotNumber: number | null;
      waitlistPosition: number | null;
      paymentDeadlineAt: Date | null;
      amountCents: number;
      memberName: string;
      /**
       * Whether outcomes are already public. Before release a silent add is
       * correct; after it, this person holds a spot with a payment clock
       * running that they know nothing about, and the caller says so.
       */
      resultsReleased: boolean;
    }
  | { ok: false; reason: RosterAddFailure };

/** The columns every write path returns, so the caller does not care which ran. */
interface WrittenRow {
  id: string;
  spot_number: number | null;
  waitlist_position: number | null;
  payment_deadline_at: Date | null;
  amount_cents: number;
}

const WRITTEN = "id, spot_number, waitlist_position, payment_deadline_at, amount_cents";

export async function addMemberToTrip(
  tripId: string,
  memberId: string,
  boardUserId: string | null,
  to: RosterAddDestination,
): Promise<RosterAddResult> {
  if (!tripId || !memberId) return { ok: false, reason: "member_missing" };

  return withTripLock<RosterAddResult>(tripId, async (client, trip) => {
    if (!trip) return { ok: false, reason: "trip_missing" };

    const { rows: memberRows } = await client.query<{
      first_name: string;
      last_name: string;
      is_blocked: boolean;
    }>(`select first_name, last_name, is_blocked from members where id = $1`, [memberId]);

    const member = memberRows[0];
    if (!member) return { ok: false, reason: "member_missing" };
    if (member.is_blocked) return { ok: false, reason: "member_blocked" };

    // The board rides free and off-capacity, so which list the caller asked for
    // does not apply to them: there is no spot to take and no waitlist to wait on.
    const board = await isBoardMember(client, memberId);

    if (to === "trip" && !board) await releaseLapsedHolds(client, tripId);

    // `signups_one_active_per_member` would reject the write anyway. Catching
    // it here turns a raw 23505 into something the board can read.
    const { rows: activeRows } = await client.query(
      `select 1 from signups
        where trip_id = $1 and member_id = $2 and status in ('held','paid','waitlisted')
        limit 1`,
      [tripId, memberId],
    );
    if (activeRows.length > 0) return { ok: false, reason: "already_active" };

    // A comped seat occupies neither a spot nor a queue position: both stay null.
    let spot: number | null = null;
    let position: number | null = null;

    if (
      !board &&
      to === "waitlist" &&
      trip.results_released_at === null &&
      trip.claim_counter < trip.capacity
    ) {
      return { ok: false, reason: "spots_open" };
    }

    if (!board && to === "trip") {
      spot = await nextSpot(client, tripId, trip.capacity);
    } else if (!board) {
      // The end of the waitlist. `waitlist_cap` is deliberately not checked: it
      // exists to stop a drop-night stampede, and this is one person by hand.
      const { rows: tailRows } = await client.query<{ next: number }>(
        `select coalesce(max(waitlist_position), 0) + 1 as next
           from signups where trip_id = $1 and status = 'waitlisted'`,
        [tripId],
      );
      position = tailRows[0].next;
    }

    // The member's dead row on this trip, if any. Newest first: after repeated
    // release and re-add, the most recent record is the one that reads as current.
    const { rows: deadRows } = await client.query<{ id: string }>(
      `select id from signups
        where trip_id = $1 and member_id = $2
          and status in ('expired','cancelled','refunded')
        order by claim_seq desc
        limit 1`,
      [tripId, memberId],
    );

    const revived = deadRows.length > 0;
    let written: WrittenRow;

    if (revived && board) {
      // A board member who was on this trip and came off it. The row goes back
      // as a comped seat rather than to whatever it was before.
      const { rows } = await client.query<WrittenRow>(
        `update signups
            set status = 'paid', board_seat = true, amount_cents = 0,
                spot_number = null, waitlist_position = null,
                payment_deadline_at = null, paid_at = now(),
                released_at = null, release_reason = null,
                created_by_board_user_id = $3::uuid, updated_at = now()
          where id = $1 and trip_id = $2
          returning ${WRITTEN}`,
        [deadRows[0].id, tripId, boardUserId],
      );
      written = rows[0];
    } else if (revived) {
      /**
       * `amount_cents` is left alone: it is the price snapshot from when they
       * entered, and what they owe should not move because the board edited the
       * trip in between.
       *
       * The one exception is a dead row that was a comped board seat - someone
       * who has since left the board being re-added as an ordinary rider. Left
       * as-is it comes back board_seat with amount 0 and paid_at set: a free
       * rider every occupancy count excludes, occupying a spot no counter value
       * backs. That row becomes an ordinary one here and owes the current price.
       */
      const { rows } = await client.query<WrittenRow>(
        `update signups
            set status              = case when $3::int is not null then 'held'::signup_status
                                                                    else 'waitlisted'::signup_status end,
                spot_number         = $3::int,
                waitlist_position   = $4::int,
                payment_deadline_at = case when $3::int is not null
                                           then now() + make_interval(hours => $5::int) end,
                amount_cents        = case when board_seat then $7::int else amount_cents end,
                paid_at             = case when board_seat then null else paid_at end,
                paid_offline        = case when board_seat then false else paid_offline end,
                board_seat          = false,
                released_at         = null,
                release_reason      = null,
                created_by_board_user_id = $6::uuid,
                updated_at          = now()
          where id = $1 and trip_id = $2
          returning ${WRITTEN}`,
        [
          deadRows[0].id,
          tripId,
          spot,
          position,
          trip.payment_window_hours,
          boardUserId,
          trip.price_cents,
        ],
      );
      written = rows[0];

      // A revive onto the waitlist grows it without consuming a counter value.
      if (position !== null) await pinClaimCounter(client, tripId, position);
    } else if (board) {
      // A negative claim_seq, and the counter is left alone. Bumping it for a
      // comped seat would make the claim hand out one fewer spot than the trip
      // has - see the board_seat column comment in schema.ts.
      const { rows } = await client.query<WrittenRow>(
        `insert into signups (
           trip_id, member_id, claim_seq, status, spot_number, waitlist_position,
           claimed_at, payment_deadline_at, paid_at, amount_cents, pay_token,
           board_seat, created_by_board_user_id
         ) values (
           $1, $2, ${NEXT_BOARD_SEQ}, 'paid', null, null,
           now(), null, now(), 0, $3, true, $4::uuid
         )
         returning ${WRITTEN}`,
        [tripId, memberId, generatePayToken(), boardUserId],
      );
      written = rows[0];
    } else {
      // A fresh arrival number rather than a reused one. Under the trip lock
      // this is the same increment the claim makes, and it keeps `claim_seq`
      // unique within the trip, which `signups_unique_seq` requires.
      const { rows: seqRows } = await client.query<{ n: number }>(
        `update trips set claim_counter = claim_counter + 1, updated_at = now()
          where id = $1
          returning claim_counter::int as n`,
        [tripId],
      );

      const { rows } = await client.query<WrittenRow>(
        `insert into signups (
           trip_id, member_id, claim_seq, status, spot_number, waitlist_position,
           claimed_at, payment_deadline_at, amount_cents, pay_token,
           created_by_board_user_id
         ) values (
           $1, $2, $3,
           (case when $4::int is not null then 'held' else 'waitlisted' end)::signup_status,
           $4::int, $5::int, now(),
           (case when $4::int is not null
                 then now() + make_interval(hours => $6::int) end),
           $7, $8, $9::uuid
         )
         returning ${WRITTEN}`,
        [
          tripId,
          memberId,
          seqRows[0].n,
          spot,
          position,
          trip.payment_window_hours,
          trip.price_cents,
          generatePayToken(),
          boardUserId,
        ],
      );
      written = rows[0];

      // Like a revive, a board-placed waitlist position is one no claim consumed.
      if (position !== null) await pinClaimCounter(client, tripId, position);
    }

    // A revived row keeps its old arrival number (negative for a former board
    // seat), so the spot it takes may be above the counter.
    if (written.spot_number !== null) {
      await keepCounterAtLeast(client, tripId, written.spot_number);
    }

    await auditInTransaction(client, boardUserId, "signup.board_add", "signup", written.id, {
      tripId,
      memberId,
      to,
      revived,
      boardSeat: board,
      spotNumber: written.spot_number,
      waitlistPosition: written.waitlist_position,
    });

    return {
      ok: true,
      signupId: written.id,
      revived,
      boardSeat: board,
      status: board ? "board" : written.spot_number !== null ? "held" : "waitlisted",
      spotNumber: written.spot_number,
      waitlistPosition: written.waitlist_position,
      paymentDeadlineAt: written.payment_deadline_at,
      amountCents: written.amount_cents,
      memberName: `${member.first_name} ${member.last_name}`,
      resultsReleased: trip.results_released_at !== null,
    };
  });
}
