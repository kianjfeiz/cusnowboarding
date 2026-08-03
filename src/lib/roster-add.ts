import { pool } from "@/lib/db";
import { isBoardMember, NEXT_BOARD_SEQ } from "@/lib/board-seats";
import { generatePayToken } from "@/lib/claims/claim";
import { releaseLapsedHolds } from "@/lib/promotion";

/**
 * Putting someone on a trip who did not win the spot themselves.
 *
 * Everything else that creates a place on a roster requires the member to have
 * been in the drop: the claim statement only ever makes new rows during the
 * signup window, promotion only accepts a waitlisted row, and reinstate only
 * accepts a row that was already on the trip and died. None of those covers the
 * ordinary case the board actually hits after results go out - someone messages
 * the president, a driver is added, a rider who never entered takes the seat of
 * one who dropped. That was a psql job.
 *
 * Structurally this is the third sibling of promoteFromWaitlist and
 * reinstateSignup: cold path, one short explicit transaction, and the same lock
 * order - `trips` is taken `for update` before anything reads or writes
 * `signups`. A coordinator adding someone while another promotes on the same
 * trip is an entirely ordinary evening.
 *
 * Two shapes of write, decided by what the member already has on this trip:
 *
 *   - A dead row (expired, cancelled, refunded) is REVIVED. The member entered
 *     once and their `claim_seq` is the record of when; a second row would
 *     leave the drop log claiming they entered twice.
 *   - Otherwise a new row is inserted, taking the next `claim_counter` value so
 *     its arrival order reads as what it is: after everyone who raced for it.
 *
 * `created_by_board_user_id` is what separates the two on the roster later. A
 * spot nobody claimed should never be indistinguishable from one that was won.
 */

export type RosterAddFailure =
  | "trip_missing"
  | "member_missing"
  | "member_blocked"
  /** They already hold a spot or sit on the waitlist for this trip. */
  | "already_active"
  /** Every spot number is taken; the waitlist is the only place left. */
  | "no_free_spot";

export type RosterAddDestination = "trip" | "waitlist";

export type RosterAddResult =
  | {
      ok: true;
      signupId: string;
      /** True when an existing released or cancelled row came back. */
      revived: boolean;
      status: "held" | "waitlisted" | "board";
      /**
       * True when the member is on the board, so they were comped rather than
       * given one of the trip's spots - whatever the caller asked for. The
       * caller uses this to decide not to email: the board is not told it is
       * on the trips it runs.
       */
      boardSeat: boolean;
      spotNumber: number | null;
      waitlistPosition: number | null;
      paymentDeadlineAt: Date | null;
      amountCents: number;
      payToken: string;
      tripTitle: string;
      memberEmail: string;
      memberFirstName: string;
      memberName: string;
      /**
       * Whether outcomes are already public on this trip, which decides
       * whether this person has to be emailed. Before release nobody has been
       * told anything and a silent add is correct; after it, they are holding a
       * spot with a payment clock running that they know nothing about.
       */
      resultsReleased: boolean;
    }
  | { ok: false; reason: RosterAddFailure };

/** The columns both write paths return, so the caller does not care which ran. */
interface WrittenRow {
  id: string;
  spot_number: number | null;
  waitlist_position: number | null;
  payment_deadline_at: Date | null;
  amount_cents: number;
  pay_token: string;
}

export async function addMemberToTrip(
  tripId: string,
  memberId: string,
  boardUserId: string | null,
  to: RosterAddDestination,
): Promise<RosterAddResult> {
  if (!tripId || !memberId) return { ok: false, reason: "member_missing" };

  const client = await pool.connect();

  try {
    await client.query("begin");

    const { rows: tripRows } = await client.query<{
      capacity: number;
      payment_window_hours: number;
      price_cents: number;
      title: string;
      results_released_at: Date | null;
    }>(
      `select capacity, payment_window_hours, price_cents, title, results_released_at
         from trips where id = $1 for update`,
      [tripId],
    );

    if (tripRows.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "trip_missing" };
    }
    const trip = tripRows[0];

    const { rows: memberRows } = await client.query<{
      email: string;
      first_name: string;
      last_name: string;
      is_blocked: boolean;
    }>(
      `select email::text as email, first_name, last_name, is_blocked
         from members where id = $1`,
      [memberId],
    );

    if (memberRows.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "member_missing" };
    }
    if (memberRows[0].is_blocked) {
      await client.query("rollback");
      return { ok: false, reason: "member_blocked" };
    }
    const member = memberRows[0];

    /*
      The board rides free and off-capacity, so which list the caller asked for
      does not apply to them: there is no spot to take and no waitlist to wait
      on. Checked before any allocation, because a board seat needs none of it.
    */
    const board = await isBoardMember(client, memberId);

    /**
     * A lapsed hold still physically occupies its spot_number until something
     * releases it. Without this the board would be told the trip is full while
     * the roster above the search box reports a free spot - the same reason
     * promotion and reinstate both do it first.
     */
    if (to === "trip" && !board) await releaseLapsedHolds(client, tripId);

    // `signups_one_active_per_member` would reject the write anyway. Catching
    // it here turns a raw 23505 into something the board can read.
    const { rows: activeRows } = await client.query<{ id: string }>(
      `select id from signups
        where trip_id = $1 and member_id = $2 and status in ('held','paid','waitlisted')
        limit 1`,
      [tripId, memberId],
    );
    if (activeRows.length > 0) {
      await client.query("rollback");
      return { ok: false, reason: "already_active" };
    }

    let spot: number | null = null;
    let position: number | null = null;

    if (board) {
      // Nothing to allocate. Both stay null, which is the shape schema.ts
      // describes: a comped seat occupies neither a spot nor a queue position.
    } else if (to === "trip") {
      // Lowest unoccupied spot number, so the roster stays dense. Never a
      // count(*) against capacity - that reads a snapshot and oversells.
      const { rows: freeRows } = await client.query<{ spot: number }>(
        `select gs as spot
           from generate_series(1, $2) gs
          where not exists (
            select 1 from signups s where s.trip_id = $1 and s.spot_number = gs
          )
          order by gs
          limit 1`,
        [tripId, trip.capacity],
      );

      if (freeRows.length === 0) {
        await client.query("rollback");
        return { ok: false, reason: "no_free_spot" };
      }
      spot = freeRows[0].spot;
    } else {
      // The end of the waitlist. `waitlist_cap` is deliberately not checked:
      // it exists to stop a drop-night stampede writing rows forever, and this
      // is a board member deciding to add one person by hand.
      const { rows: tailRows } = await client.query<{ next: number }>(
        `select coalesce(max(waitlist_position), 0) + 1 as next
           from signups where trip_id = $1 and status = 'waitlisted'`,
        [tripId],
      );
      position = tailRows[0].next;
    }

    // A row that already exists for this member on this trip and is no longer
    // live. Newest first: if the board has released and re-added someone more
    // than once, the most recent record is the one that reads as current.
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
      /*
        A board member who was on this trip and came off it. The row goes back
        as a comped seat rather than to whatever it was before - if they paid
        for it last time, the money is a refund conversation for the treasurer
        and not something to quietly zero out here, which is why only released
        and cancelled rows are revivable at all.
      */
      const { rows } = await client.query<WrittenRow>(
        `update signups
            set status = 'paid', board_seat = true, amount_cents = 0,
                spot_number = null, waitlist_position = null,
                payment_deadline_at = null, paid_at = now(),
                released_at = null, release_reason = null,
                created_by_board_user_id = $3::uuid, updated_at = now()
          where id = $1 and trip_id = $2
          returning id, spot_number, waitlist_position, payment_deadline_at,
                    amount_cents, pay_token`,
        [deadRows[0].id, tripId, boardUserId],
      );
      written = rows[0];
    } else if (revived) {
      /**
       * `released_at` and `release_reason` are cleared because the row is live
       * again and those two columns are what every reader uses to tell a live
       * signup from a dead one. `amount_cents` is left alone: it is the price
       * snapshot from when they entered, and what they owe should not move
       * because the board edited the trip in between.
       */
      const { rows } = await client.query<WrittenRow>(
        `update signups
            set status              = case when $3::int is not null then 'held'::signup_status
                                                                    else 'waitlisted'::signup_status end,
                spot_number         = $3::int,
                waitlist_position   = $4::int,
                payment_deadline_at = case when $3::int is not null
                                           then now() + make_interval(hours => $5::int) end,
                released_at         = null,
                release_reason      = null,
                created_by_board_user_id = $6::uuid,
                updated_at          = now()
          where id = $1 and trip_id = $2
          returning id, spot_number, waitlist_position, payment_deadline_at,
                    amount_cents, pay_token`,
        [deadRows[0].id, tripId, spot, position, trip.payment_window_hours, boardUserId],
      );
      written = rows[0];
    } else if (board) {
      /*
        A negative claim_seq, and the counter is left alone. Bumping it for a
        comped seat would make the claim statement hand out one fewer spot than
        the trip has - see the board_seat column comment in schema.ts.
      */
      const { rows } = await client.query<WrittenRow>(
        `insert into signups (
           trip_id, member_id, claim_seq, status, spot_number, waitlist_position,
           claimed_at, payment_deadline_at, paid_at, amount_cents, pay_token,
           board_seat, created_by_board_user_id
         ) values (
           $1, $2, ${NEXT_BOARD_SEQ}, 'paid', null, null,
           now(), null, now(), 0, $3, true, $4::uuid
         )
         returning id, spot_number, waitlist_position, payment_deadline_at,
                   amount_cents, pay_token`,
        [tripId, memberId, generatePayToken(), boardUserId],
      );
      written = rows[0];
    } else {
      /**
       * A fresh arrival number rather than a reused one. We hold the trip row
       * lock, so this is the same increment the claim statement makes, minus
       * the race it is built to survive - and it keeps `claim_seq` total and
       * unique within the trip, which `signups_unique_seq` requires.
       */
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
         returning id, spot_number, waitlist_position, payment_deadline_at,
                   amount_cents, pay_token`,
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
    }

    await client.query(
      `insert into audit_events (actor_board_user_id, action, entity_type, entity_id, data)
       values ($1, 'signup.board_add', 'signup', $2, $3::jsonb)`,
      [
        boardUserId,
        written.id,
        JSON.stringify({
          tripId,
          memberId,
          to,
          revived,
          boardSeat: board,
          spotNumber: written.spot_number,
          waitlistPosition: written.waitlist_position,
        }),
      ],
    );

    await client.query("commit");

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
      payToken: written.pay_token,
      tripTitle: trip.title,
      memberEmail: member.email,
      memberFirstName: member.first_name,
      memberName: `${member.first_name} ${member.last_name}`,
      resultsReleased: trip.results_released_at !== null,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
