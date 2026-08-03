import { pool } from "@/lib/db";

/**
 * Pre-release roster curation.
 *
 * The drop allocates strictly by arrival order, and that allocation is right far
 * more often than not. But for the fifteen or twenty minutes between the drop
 * and "Send results" the travel coordinator knows things the counter does not -
 * who is driving, who has the rack, who entered twice on two phones - and pulls
 * a few people up off the waitlist while others go down. This applies the whole
 * reshuffle in one go.
 *
 * Two rules make it safe rather than terrifying:
 *
 *   1. It refuses once `results_released_at` is set. After outcomes are public,
 *      moving someone off the trip has to go through release/cancel/promote,
 *      which notify the person. Silently reshuffling a published roster would
 *      strand a member who was told they were going and never told otherwise.
 *   2. It never moves a `paid` signup off the trip. Money changed hands; taking
 *      that spot back is a refund decision, not a drag gesture.
 *
 * `claim_seq` is never touched. It is the permanent record of arrival order and
 * the only thing that can settle "but I clicked first" later.
 */

export type RosterEditRefusal =
  /** No such trip. */
  | "trip_missing"
  /** Outcomes are already public; use release/cancel/promote instead. */
  | "already_released"
  /** The same signup was listed twice. */
  | "duplicate_signup"
  /** An id that is not an active signup on this trip. */
  | "unknown_signup"
  /** An active signup on this trip was left out of both lists. */
  | "missing_signup"
  /** More people on the trip than there are seats. */
  | "over_capacity"
  /** Someone who has paid was pushed to the waitlist. */
  | "cannot_move_paid";

export interface RosterAssignmentResult {
  ok: boolean;
  reason?: RosterEditRefusal;
  /** The signup a refusal names, where one is identifiable. */
  signupId?: string;
  /** Member name for that signup, so the caller can write a usable message. */
  signupName?: string;
  capacity?: number;
  onTripCount?: number;
  waitlistCount?: number;
  /** Signup ids that came up from the waitlist. */
  movedToTrip?: string[];
  /** Signup ids that went down to the waitlist. */
  movedToWaitlist?: string[];
}

export interface RosterAssignment {
  /** Signup ids in the desired spot order, 1..n. */
  onTrip: string[];
  /** Signup ids in the desired waitlist order, 1..m. */
  waitlisted: string[];
}

interface CurrentRow {
  id: string;
  status: string;
  first_name: string;
  last_name: string;
}

/**
 * Positions are rewritten through a high offset range, the same trick
 * `renumberWaitlist` uses and for the same reason: `signups_unique_spot` and
 * `signups_unique_waitlist_pos` are checked per row rather than at statement
 * end, so a permutation applied in one UPDATE can collide with itself depending
 * on the order rows happen to be processed. Parking every row out of range first
 * makes the rewrite order-independent.
 */
const OFFSET = 1_000_000;

export async function applyRosterAssignment(
  tripId: string,
  boardUserId: string | null,
  desired: RosterAssignment,
): Promise<RosterAssignmentResult> {
  const client = await pool.connect();

  try {
    await client.query("begin");

    // Trips first, then signups - the same lock order promoteFromWaitlist uses.
    // A save landing mid-promotion must queue behind it, not deadlock with it.
    const { rows: tripRows } = await client.query<{
      capacity: number;
      payment_window_hours: number;
      results_released_at: Date | null;
    }>(
      `select capacity, payment_window_hours, results_released_at
         from trips where id = $1 for update`,
      [tripId],
    );

    if (tripRows.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "trip_missing" };
    }

    const { capacity, payment_window_hours: windowHours } = tripRows[0];

    if (tripRows[0].results_released_at) {
      await client.query("rollback");
      return { ok: false, reason: "already_released" };
    }

    /*
      Comped board seats are not part of the ordering and never appear on the
      board. They hold no spot number and no waitlist position, so there is
      nothing about them to drag; including them here would make every save
      fail the `missing_signup` check against a card that was never rendered.
    */
    const { rows: current } = await client.query<CurrentRow>(
      `select s.id, s.status::text as status, m.first_name, m.last_name
         from signups s
         join members m on m.id = s.member_id
        where s.trip_id = $1 and s.status in ('held','paid','waitlisted')
          and not s.board_seat
        order by s.claim_seq
        for update of s`,
      [tripId],
    );

    const byId = new Map(current.map((row) => [row.id, row]));
    const ids = [...desired.onTrip, ...desired.waitlisted];

    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        await client.query("rollback");
        return { ok: false, reason: "duplicate_signup", signupId: id, ...nameOf(byId, id) };
      }
      seen.add(id);

      if (!byId.has(id)) {
        await client.query("rollback");
        return { ok: false, reason: "unknown_signup", signupId: id };
      }
    }

    // The board is reordering a snapshot it loaded a moment ago. If the set has
    // moved underneath it - a claim landed, someone cancelled - refuse rather
    // than apply a partial ordering and drop a person off the roster entirely.
    const omitted = current.find((row) => !seen.has(row.id));
    if (omitted) {
      await client.query("rollback");
      return {
        ok: false,
        reason: "missing_signup",
        signupId: omitted.id,
        signupName: fullName(omitted),
      };
    }

    if (desired.onTrip.length > capacity) {
      await client.query("rollback");
      return {
        ok: false,
        reason: "over_capacity",
        capacity,
        onTripCount: desired.onTrip.length,
      };
    }

    const paidPushedOff = desired.waitlisted
      .map((id) => byId.get(id))
      .find((row) => row?.status === "paid");
    if (paidPushedOff) {
      await client.query("rollback");
      return {
        ok: false,
        reason: "cannot_move_paid",
        signupId: paidPushedOff.id,
        signupName: fullName(paidPushedOff),
      };
    }

    const movedToTrip = desired.onTrip.filter((id) => byId.get(id)?.status === "waitlisted");
    const movedToWaitlist = desired.waitlisted.filter(
      (id) => byId.get(id)?.status !== "waitlisted",
    );

    await client.query(
      `update signups
          set spot_number       = case when spot_number is not null then spot_number + $2 end,
              waitlist_position = case when waitlist_position is not null
                                       then waitlist_position + $2 end
        where trip_id = $1 and status in ('held','paid','waitlisted')
          and not board_seat`,
      [tripId, OFFSET],
    );

    const spots = ids.map((_, i) => (i < desired.onTrip.length ? i + 1 : null));
    const positions = ids.map((_, i) =>
      i < desired.onTrip.length ? null : i - desired.onTrip.length + 1,
    );

    await client.query(
      `with target as (
         select id, spot, pos from unnest($2::uuid[], $3::int[], $4::int[]) as t(id, spot, pos)
       )
       update signups s
          set status = case
                         -- A paid rider keeps their status; only the seat moves.
                         when t.spot is not null and s.status = 'paid' then 'paid'::signup_status
                         when t.spot is not null then 'held'::signup_status
                         else 'waitlisted'::signup_status
                       end,
              spot_number       = t.spot,
              waitlist_position = t.pos,
              -- Only a row arriving from the waitlist needs a deadline invented,
              -- and only so it satisfies signups_held_has_deadline. Releasing
              -- results resets every one of these to a window the member can
              -- actually act on, which is the deadline that counts.
              payment_deadline_at = case
                when t.spot is not null and s.status = 'waitlisted'
                  then now() + make_interval(hours => $5::int)
                when t.spot is not null then s.payment_deadline_at
                else null
              end,
              updated_at = now()
         from target t
        where s.id = t.id and s.trip_id = $1`,
      [tripId, ids, spots, positions, windowHours],
    );

    // One row for the whole reshuffle rather than one per person: the decision
    // the coordinator made was "this is the group", not thirty separate moves.
    await client.query(
      `insert into audit_events (actor_board_user_id, action, entity_type, entity_id, data)
       values ($1, 'trip.roster_reordered', 'trip', $2, $3::jsonb)`,
      [
        boardUserId,
        tripId,
        JSON.stringify({
          onTrip: desired.onTrip.length,
          waitlisted: desired.waitlisted.length,
          capacity,
          movedToTrip,
          movedToWaitlist,
        }),
      ],
    );

    await client.query("commit");

    return {
      ok: true,
      capacity,
      onTripCount: desired.onTrip.length,
      waitlistCount: desired.waitlisted.length,
      movedToTrip,
      movedToWaitlist,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function fullName(row: CurrentRow): string {
  return `${row.first_name} ${row.last_name}`;
}

function nameOf(byId: Map<string, CurrentRow>, id: string): { signupName?: string } {
  const row = byId.get(id);
  return row ? { signupName: fullName(row) } : {};
}
