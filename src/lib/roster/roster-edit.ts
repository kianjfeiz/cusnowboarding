import {
  auditInTransaction,
  keepCounterAtLeast,
  pinClaimCounter,
  withTripLock,
} from "@/lib/roster/promotion";

/**
 * The board's drag-and-drop roster: the whole on-trip and waitlist ordering is
 * applied in one go, before results are sent (curation) and after (people
 * drop, others take their place).
 *
 *   - Capacity is a target, not a wall: the board may put more people on the
 *     trip than it was slated for. Spots stay dense, 1..n.
 *   - It never moves a `paid` signup off the trip. Taking that spot back is a
 *     refund decision, not a drag gesture.
 *   - After release, coming up off the waitlist is a promotion - the payment
 *     window starts now and promoted_at/by record who decided - and nobody is
 *     emailed either way; whoever the board moves, the board tells.
 *
 * `claim_seq` is never touched. It is the permanent record of arrival order and
 * the only thing that can settle "but I clicked first" later.
 */

type RosterEditRefusal =
  /** No such trip. */
  | "trip_missing"
  /** The same signup was listed twice. */
  | "duplicate_signup"
  /** An id that is not an active signup on this trip. */
  | "unknown_signup"
  /** An active signup on this trip was left out of both lists. */
  | "missing_signup"
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
  /** Whether results were already out, so the move was a promotion or demotion. */
  released?: boolean;
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
 * `renumberWaitlist` uses and for the same reason: the partial unique indexes
 * are checked per row, so a permutation applied in one UPDATE can collide with
 * itself. Parking every row out of range first makes it order-independent.
 */
const OFFSET = 1_000_000;

const fullName = (row: CurrentRow) => `${row.first_name} ${row.last_name}`;

export async function applyRosterAssignment(
  tripId: string,
  boardUserId: string | null,
  desired: RosterAssignment,
): Promise<RosterAssignmentResult> {
  return withTripLock<RosterAssignmentResult>(tripId, async (client, trip) => {
    if (!trip) return { ok: false, reason: "trip_missing" };
    const { capacity } = trip;
    const released = trip.results_released_at !== null;

    // Comped board seats hold no spot and no position, so they are never
    // rendered as cards; including them would fail every save on `missing_signup`.
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
      const row = byId.get(id);
      if (!row) return { ok: false, reason: "unknown_signup", signupId: id };
      if (seen.has(id)) {
        return { ok: false, reason: "duplicate_signup", signupId: id, signupName: fullName(row) };
      }
      seen.add(id);
    }

    // The board is reordering a snapshot it loaded a moment ago. If the set has
    // moved underneath it - a claim landed, someone cancelled - refuse rather
    // than apply a partial ordering and drop a person off the roster entirely.
    const omitted = current.find((row) => !seen.has(row.id));
    if (omitted) {
      return {
        ok: false,
        reason: "missing_signup",
        signupId: omitted.id,
        signupName: fullName(omitted),
      };
    }

    const paidPushedOff = desired.waitlisted
      .map((id) => byId.get(id))
      .find((row) => row?.status === "paid");
    if (paidPushedOff) {
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
              -- A row arriving from the waitlist starts its payment window now.
              -- Before release that only satisfies signups_held_has_deadline,
              -- since releasing results resets every one; after, it is real.
              payment_deadline_at = case
                when t.spot is not null and s.status = 'waitlisted'
                  then now() + make_interval(hours => $5::int)
                when t.spot is not null then s.payment_deadline_at
                else null
              end,
              promoted_at = case
                when $6::boolean and t.spot is not null and s.status = 'waitlisted' then now()
                else s.promoted_at
              end,
              promoted_by = case
                when $6::boolean and t.spot is not null and s.status = 'waitlisted' then $7::uuid
                else s.promoted_by
              end,
              updated_at = now()
         from target t
        where s.id = t.id and s.trip_id = $1`,
      [tripId, ids, spots, positions, trip.payment_window_hours, released, boardUserId],
    );

    // Claims may still be open. Spots are now 1..n, so the counter must be at
    // least n or the next claim computes a spot the board just filled (a row
    // revived from a board seat, say, never consumed a counter value).
    // Demoting a held rider adds a waitlist position the same way, so with
    // anyone waitlisted the counter must also clear capacity + m. With nobody
    // waitlisted, pinning to capacity would waitlist every later entrant on a
    // trip that still has free spots, so that pin is skipped.
    await keepCounterAtLeast(client, tripId, desired.onTrip.length);
    if (desired.waitlisted.length > 0) {
      await pinClaimCounter(client, tripId, desired.waitlisted.length);
    }

    // One row for the whole reshuffle rather than one per person: the decision
    // the coordinator made was "this is the group", not thirty separate moves.
    await auditInTransaction(client, boardUserId, "trip.roster_reordered", "trip", tripId, {
      onTrip: desired.onTrip.length,
      waitlisted: desired.waitlisted.length,
      capacity,
      resultsReleased: released,
      movedToTrip,
      movedToWaitlist,
    });

    return {
      ok: true,
      capacity,
      onTripCount: desired.onTrip.length,
      waitlistCount: desired.waitlisted.length,
      movedToTrip,
      movedToWaitlist,
      released,
    };
  });
}
