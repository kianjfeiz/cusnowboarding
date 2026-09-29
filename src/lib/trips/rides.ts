import type { PoolClient } from "pg";
import { execute, pool, transaction } from "@/lib/db";

/**
 * The ride sheet: members on a trip offering seats in their cars, and other
 * members claiming them. It replaces the shared spreadsheet, nothing more.
 *
 * Access mirrors the roster page exactly: roster finalized AND the viewer
 * actually going (`signups.status = 'paid'`). Names and phone numbers are shared
 * with the people in the cars and nobody else - deliberately not the
 * board-moderator rule from photos, since the board reads rosters in /admin.
 *
 * CONCURRENCY. Seat claims run in a transaction that locks the RIDE row first;
 * with the lock held a plain count of riders is trustworthy, because any
 * competing claim is parked on the same lock. These transactions touch rides
 * and ride_riders only - never signups or trips - so they cannot deadlock with
 * the trips-first paths in promotion.ts.
 */

const PHONE_MIN_DIGITS = 7;

/** Free text like the sheet, but it has to be dialable-ish and fit on a card. */
function normalizePhone(raw: string): string | null {
  const value = raw.trim().slice(0, 30);
  const digits = value.replace(/\D/g, "");
  return digits.length >= PHONE_MIN_DIGITS ? value : null;
}

interface RideRider {
  memberId: string;
  name: string;
  phone: string;
}

export interface RideView {
  id: string;
  driverMemberId: string;
  driverName: string;
  phone: string;
  seatCapacity: number;
  departsNote: string;
  returnsNote: string | null;
  riders: RideRider[];
}

export interface RideSheet {
  rides: RideView[];
  /** How the viewer already participates, if at all. */
  viewer: { drivingRideId: string | null; seatRideId: string | null };
}

/** Whether the sheet is open to this member at all - the roster page's gate. */
export async function canUseRideSheet(tripId: string, memberId: string): Promise<boolean> {
  return isSheetMember(pool, tripId, memberId);
}

export async function getRideSheet(tripId: string, memberId: string): Promise<RideSheet> {
  const [rides, riders] = await Promise.all([
    execute<Omit<RideView, "riders">>(
      `select r.id, r.driver_member_id as "driverMemberId",
              m.first_name || ' ' || m.last_name as "driverName",
              r.phone, r.seat_capacity as "seatCapacity",
              r.departs_note as "departsNote", r.returns_note as "returnsNote"
         from rides r
         join members m on m.id = r.driver_member_id
        where r.trip_id = $1
        order by r.created_at`,
      [tripId],
    ),
    execute<RideRider & { rideId: string }>(
      `select rr.ride_id as "rideId", rr.member_id as "memberId",
              m.first_name || ' ' || m.last_name as name,
              rr.phone
         from ride_riders rr
         join members m on m.id = rr.member_id
        where rr.trip_id = $1
        order by rr.created_at`,
      [tripId],
    ),
  ]);

  const byRide = new Map<string, RideRider[]>();
  for (const { rideId, ...rider } of riders) {
    byRide.set(rideId, [...(byRide.get(rideId) ?? []), rider]);
  }

  return {
    rides: rides.map((ride) => ({ ...ride, riders: byRide.get(ride.id) ?? [] })),
    viewer: {
      drivingRideId: rides.find((r) => r.driverMemberId === memberId)?.id ?? null,
      seatRideId: riders.find((r) => r.memberId === memberId)?.rideId ?? null,
    },
  };
}

/**
 * The one definition of who the sheet is for. Checked INSIDE the write
 * transactions and not only at the page, so a form submitted hours after
 * render still hits the rule.
 */
async function isSheetMember(
  client: PoolClient | typeof pool,
  tripId: string,
  memberId: string,
): Promise<boolean> {
  const result = await client.query(
    `select 1
       from signups s
       join trips t on t.id = s.trip_id
      where s.trip_id = $1 and s.member_id = $2 and s.status = 'paid'
        and t.roster_finalized_at is not null
        and t.archived_at is null`,
    [tripId, memberId],
  );
  return (result.rowCount ?? 0) > 0;
}

export type OfferRideResult =
  | { ok: true; rideId: string }
  | { ok: false; reason: "already_driving" | "already_seated" | "not_attendee" | "invalid" };

export async function offerRide(
  tripId: string,
  memberId: string,
  input: { seatCapacity: number; phone: string; departsNote: string; returnsNote: string | null },
): Promise<OfferRideResult> {
  const phone = normalizePhone(input.phone);
  const departsNote = input.departsNote.trim().slice(0, 120);
  const returnsNote = input.returnsNote?.trim().slice(0, 120) || null;
  const seats = Math.trunc(input.seatCapacity);

  if (!phone || !departsNote || seats < 1 || seats > 8) return { ok: false, reason: "invalid" };

  return transaction(async (client) => {
    if (!(await isSheetMember(client, tripId, memberId))) {
      return { ok: false, reason: "not_attendee" as const };
    }

    // A driver with a seat elsewhere is double-parked: release the seat first,
    // deliberately, rather than have offering a car silently vacate it.
    const seated = await client.query(
      `select 1 from ride_riders where trip_id = $1 and member_id = $2`,
      [tripId, memberId],
    );
    if (seated.rowCount) return { ok: false, reason: "already_seated" as const };

    const inserted = await client.query<{ id: string }>(
      `insert into rides (trip_id, driver_member_id, seat_capacity, phone, departs_note, returns_note)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (trip_id, driver_member_id) do nothing
       returning id`,
      [tripId, memberId, seats, phone, departsNote, returnsNote],
    );
    if (!inserted.rowCount) return { ok: false, reason: "already_driving" as const };
    return { ok: true as const, rideId: inserted.rows[0].id };
  });
}

export type ClaimSeatResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "ride_missing"
        | "full"
        | "own_ride"
        | "already_seated"
        | "already_driving"
        | "not_attendee"
        | "invalid";
    };

export async function claimSeat(
  rideId: string,
  tripId: string,
  memberId: string,
  rawPhone: string,
): Promise<ClaimSeatResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, reason: "invalid" };

  return transaction(async (client) => {
    if (!(await isSheetMember(client, tripId, memberId))) {
      return { ok: false, reason: "not_attendee" as const };
    }

    // The ride row lock is what makes everything after it trustworthy.
    const ride = await client.query<{ seat_capacity: number; driver_member_id: string }>(
      `select seat_capacity, driver_member_id from rides
        where id = $1 and trip_id = $2
          for update`,
      [rideId, tripId],
    );
    if (!ride.rowCount) return { ok: false, reason: "ride_missing" as const };
    if (ride.rows[0].driver_member_id === memberId) {
      return { ok: false, reason: "own_ride" as const };
    }

    const driving = await client.query(
      `select 1 from rides where trip_id = $1 and driver_member_id = $2`,
      [tripId, memberId],
    );
    if (driving.rowCount) return { ok: false, reason: "already_driving" as const };

    const taken = await client.query<{ n: string }>(
      `select count(*) as n from ride_riders where ride_id = $1`,
      [rideId],
    );
    if (Number(taken.rows[0].n) >= ride.rows[0].seat_capacity) {
      return { ok: false, reason: "full" as const };
    }

    // The unique index on (trip_id, member_id) is the real one-seat rule; this
    // insert simply finds out which side of it we are on.
    const inserted = await client.query(
      `insert into ride_riders (ride_id, trip_id, member_id, phone)
       values ($1, $2, $3, $4)
       on conflict (trip_id, member_id) do nothing
       returning id`,
      [rideId, tripId, memberId, phone],
    );
    if (!inserted.rowCount) return { ok: false, reason: "already_seated" as const };
    return { ok: true as const };
  });
}

/** A rider giving their seat back. Idempotent - releasing nothing is fine. */
export async function releaseSeat(tripId: string, memberId: string): Promise<void> {
  await execute(`delete from ride_riders where trip_id = $1 and member_id = $2`, [
    tripId,
    memberId,
  ]);
}

/** The driver pulling their car. Riders lose their seats with it (cascade). */
export async function cancelRide(tripId: string, driverMemberId: string): Promise<void> {
  await execute(`delete from rides where trip_id = $1 and driver_member_id = $2`, [
    tripId,
    driverMemberId,
  ]);
}
