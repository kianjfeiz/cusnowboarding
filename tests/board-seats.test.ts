import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { claimSpot, generatePayToken } from "@/lib/claims/claim";
import { grantBoardSeats, compBoardMembers } from "@/lib/board-seats";
import { pool } from "@/lib/db";
import { withTripLock } from "@/lib/promotion";
import { releaseResults } from "@/lib/results";
import { addMemberToTrip } from "@/lib/roster-add";
import { applyRosterAssignment } from "@/lib/roster-edit";
import { getOccupancy } from "@/lib/trips";
import {
  createTestTrip,
  deleteTestTrips,
  getMemberIds,
  getSignups,
  setupPool,
} from "./helpers";

/**
 * The board rides free and off-capacity. Two invariants carry the whole
 * feature, and both are the kind that fail silently:
 *
 *   - A board seat must never consume a `claim_counter` value, or the claim
 *     statement hands out fewer spots than the trip has.
 *   - A board seat must never be counted as occupancy, or a trip reports itself
 *     full while the seats members were racing for are all still there.
 */

/** Members who are definitely NOT on the board, for the capacity assertions. */
let riderIds: string[];
let boardUserId: string;
/** Members this suite puts on the board. */
let boardMemberIds: string[];
/**
 * How many seats a grant should write. Not `boardMemberIds.length`: a developer
 * database has real board users in it from `bootstrap-board.ts`, and any of
 * them who is also a seeded member is just as eligible as the three below.
 */
let expectedSeats: number;

const BOARD_EMAIL_TAG = "board-seat-test";

/** Every member the board-membership join currently resolves. */
async function allBoardMemberIds(): Promise<string[]> {
  const { rows } = await setupPool.query<{ id: string }>(
    `select m.id
       from board_users b
       join members m on m.email = b.email
      where b.is_active and not m.is_blocked`,
  );
  return rows.map((r) => r.id);
}

beforeAll(async () => {
  const memberIds = await getMemberIds(30);

  const { rows: actor } = await setupPool.query<{ id: string }>(
    `insert into board_users (email, name, is_active)
     values ('${BOARD_EMAIL_TAG}-actor@colorado.edu', 'Board Seat Test', true)
     on conflict (email) do update set name = excluded.name
     returning id`,
  );
  boardUserId = actor[0].id;

  /*
    Board membership is the join `members.email = board_users.email`, so making
    somebody board is a matter of adding a board_users row carrying the address
    a seeded member already has. Anyone already on the board is left out of both
    groups, so `riderIds` really is a pool of ordinary members.
  */
  const existing = new Set(await allBoardMemberIds());
  const plain = memberIds.filter((id) => !existing.has(id));
  boardMemberIds = plain.slice(-3);
  riderIds = plain.slice(0, -3);

  const { rows: emails } = await setupPool.query<{ email: string }>(
    `select email::text as email from members where id = any($1::uuid[])`,
    [boardMemberIds],
  );
  for (const row of emails) {
    await setupPool.query(
      `insert into board_users (email, name, is_active)
       values ($1, 'Board Seat Test Member', true)
       on conflict (email) do update set is_active = true`,
      [row.email],
    );
  }

  expectedSeats = (await allBoardMemberIds()).length;
});

afterAll(async () => {
  await deleteTestTrips();
  const { rows: emails } = await setupPool.query<{ email: string }>(
    `select email::text as email from members where id = any($1::uuid[])`,
    [boardMemberIds],
  );
  const addresses = [
    ...emails.map((r) => r.email),
    `${BOARD_EMAIL_TAG}-actor@colorado.edu`,
  ];
  await setupPool.query(
    `delete from audit_events
      where actor_board_user_id in (select id from board_users where email = any($1::citext[]))`,
    [addresses],
  );
  await setupPool.query(`delete from board_users where email = any($1::citext[])`, [
    addresses,
  ]);
  await setupPool.end();
  await pool.end();
});

/** Claims from the plain-member pool only, so the counts mean what they say. */
async function fill(tripId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await claimSpot(pool, tripId, riderIds[i], generatePayToken());
  }
  return getSignups(tripId);
}

async function seats(tripId: string) {
  const { rows } = await setupPool.query<{
    id: string;
    claim_seq: number;
    status: string;
    spot_number: number | null;
    waitlist_position: number | null;
    amount_cents: number;
    payment_deadline_at: Date | null;
  }>(
    `select id, claim_seq::int as claim_seq, status::text as status, spot_number,
            waitlist_position, amount_cents, payment_deadline_at
       from signups where trip_id = $1 and board_seat
      order by claim_seq desc`,
    [tripId],
  );
  return rows;
}

const counterOf = async (tripId: string) =>
  (
    await setupPool.query<{ n: number }>(
      `select claim_counter::int as n from trips where id = $1`,
      [tripId],
    )
  ).rows[0].n;

describe("grantBoardSeats", () => {
  test("writes a free, unnumbered, negative-sequence seat per board member", async () => {
    const tripId = await createTestTrip({ capacity: 25, resultsReleased: false });

    const granted = await withTripLock(tripId, (c) =>
      grantBoardSeats(c, tripId, boardUserId),
    );
    expect(granted).toBe(expectedSeats);

    const rows = await seats(tripId);
    expect(rows).toHaveLength(expectedSeats);
    for (const row of rows) {
      expect(row.status).toBe("paid");
      expect(row.amount_cents).toBe(0);
      // Neither a spot nor a queue position: a board seat is not one of the 25.
      expect(row.spot_number).toBeNull();
      expect(row.waitlist_position).toBeNull();
      // Nothing to chase, so nothing for the reaper to find.
      expect(row.payment_deadline_at).toBeNull();
      expect(row.claim_seq).toBeLessThan(0);
    }
    // Distinct, so signups_unique_seq holds.
    expect(new Set(rows.map((r) => r.claim_seq)).size).toBe(rows.length);
  });

  test("leaves the claim counter alone, so capacity is still capacity", async () => {
    const tripId = await createTestTrip({ capacity: 4, resultsReleased: false });
    await withTripLock(tripId, (c) => grantBoardSeats(c, tripId, boardUserId));

    expect(await counterOf(tripId)).toBe(0);

    // The whole point: three board seats must not turn a 4-spot trip into a
    // 1-spot one. Four members still get spots, the fifth still waitlists.
    await fill(tripId, 5);

    const rows = await getSignups(tripId);
    const spots = rows.filter((r) => r.spot_number !== null).map((r) => r.spot_number);
    expect(spots.sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4]);
    expect(rows.filter((r) => r.status === "waitlisted")).toHaveLength(1);
  });

  test("does not count against occupancy", async () => {
    const tripId = await createTestTrip({ capacity: 10, resultsReleased: false });
    await withTripLock(tripId, (c) => grantBoardSeats(c, tripId, boardUserId));
    await fill(tripId, 2);

    const occupancy = await getOccupancy(tripId, 10);
    expect(occupancy.taken).toBe(2);
    expect(occupancy.free).toBe(8);
  });

  test("is idempotent, and skips anyone already live on the trip", async () => {
    const tripId = await createTestTrip({ capacity: 10, resultsReleased: false });

    const first = await withTripLock(tripId, (c) =>
      grantBoardSeats(c, tripId, boardUserId),
    );
    const second = await withTripLock(tripId, (c) =>
      grantBoardSeats(c, tripId, boardUserId),
    );

    expect(first).toBe(expectedSeats);
    expect(second).toBe(0);
    expect(await seats(tripId)).toHaveLength(expectedSeats);
  });

  test("skips a board member who already claimed a spot", async () => {
    const tripId = await createTestTrip({ capacity: 10, resultsReleased: false });
    await claimSpot(pool, tripId, boardMemberIds[0], generatePayToken());

    const granted = await withTripLock(tripId, (c) =>
      grantBoardSeats(c, tripId, boardUserId),
    );

    // Their claimed row is left exactly as it is; comping happens at release.
    expect(granted).toBe(expectedSeats - 1);
  });
});

describe("compBoardMembers", () => {
  test("converts a board member's claimed spot and hands the spot back", async () => {
    const tripId = await createTestTrip({ capacity: 3, resultsReleased: false });
    await claimSpot(pool, tripId, riderIds[0], generatePayToken());
    await claimSpot(pool, tripId, boardMemberIds[0], generatePayToken());

    const comped = await withTripLock(tripId, (c) => compBoardMembers(c, tripId));
    expect(comped).toBe(1);

    const rows = await getSignups(tripId);
    const board = rows.find((r) => r.member_id === boardMemberIds[0])!;
    expect(board.status).toBe("paid");
    expect(board.spot_number).toBeNull();

    // Spot 2 is free again, for a member who actually needs one.
    expect((await getOccupancy(tripId, 3)).free).toBe(2);
  });

  test("converts a waitlisted board member rather than leaving them queued", async () => {
    const tripId = await createTestTrip({ capacity: 1, resultsReleased: false });
    await claimSpot(pool, tripId, riderIds[0], generatePayToken());
    await claimSpot(pool, tripId, boardMemberIds[0], generatePayToken());

    await withTripLock(tripId, (c) => compBoardMembers(c, tripId));

    const rows = await getSignups(tripId);
    const board = rows.find((r) => r.member_id === boardMemberIds[0])!;
    expect(board.status).toBe("paid");
    expect(board.waitlist_position).toBeNull();
  });

  test("leaves a board member who genuinely paid alone", async () => {
    const tripId = await createTestTrip({ capacity: 3, resultsReleased: false });
    await claimSpot(pool, tripId, boardMemberIds[0], generatePayToken());
    await setupPool.query(
      `update signups set status = 'paid', paid_at = now() where trip_id = $1`,
      [tripId],
    );

    const comped = await withTripLock(tripId, (c) => compBoardMembers(c, tripId));

    // Money changed hands. Zeroing it here would write off a refund nobody made.
    expect(comped).toBe(0);
    const rows = await getSignups(tripId);
    expect(rows[0].spot_number).toBe(1);
  });

  test("releaseResults comps the board on the way out", async () => {
    const tripId = await createTestTrip({ capacity: 5, resultsReleased: false });
    await fill(tripId, 2);
    await claimSpot(pool, tripId, boardMemberIds[0], generatePayToken());

    const result = await releaseResults(tripId, boardUserId);
    expect(result.ok).toBe(true);
    // Two riders emailed, not three: the board is not told about its own trips.
    expect((result.spotEmails ?? 0) + (result.waitlistEmails ?? 0)).toBe(2);

    const board = (await getSignups(tripId)).find(
      (r) => r.member_id === boardMemberIds[0],
    )!;
    expect(board.spot_number).toBeNull();
    expect(board.status).toBe("paid");
  });
});

describe("adding a board member by hand", () => {
  test("comps them however the board asked", async () => {
    const tripId = await createTestTrip({ capacity: 5 });

    for (const to of ["trip", "waitlist"] as const) {
      const trip = await createTestTrip({ capacity: 5 });
      const result = await addMemberToTrip(trip, boardMemberIds[0], boardUserId, to);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The list asked for does not apply to somebody who uses neither.
      expect(result.boardSeat).toBe(true);
      expect(result.status).toBe("board");
      expect(result.spotNumber).toBeNull();
      expect(result.amountCents).toBe(0);
    }

    expect(await counterOf(tripId)).toBe(0);
  });

  test("comps them even when every spot is taken", async () => {
    const tripId = await createTestTrip({ capacity: 2 });
    await fill(tripId, 2);

    const result = await addMemberToTrip(tripId, boardMemberIds[0], boardUserId, "trip");

    // A full trip is full of members. It has nothing to say about a seat that
    // was never one of its spots.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.boardSeat).toBe(true);
  });

  test("revives a removed board member back to a comped seat", async () => {
    const tripId = await createTestTrip({ capacity: 5, resultsReleased: false });
    await withTripLock(tripId, (c) => grantBoardSeats(c, tripId, boardUserId));

    const existing = (await seats(tripId)).find((r) => r.claim_seq === -1)!;
    await setupPool.query(
      `update signups set status = 'cancelled', board_seat = false, released_at = now(),
              release_reason = 'board_cancel'
        where id = $1`,
      [existing.id],
    );
    const { rows: who } = await setupPool.query<{ member_id: string }>(
      `select member_id from signups where id = $1`,
      [existing.id],
    );

    const result = await addMemberToTrip(tripId, who[0].member_id, boardUserId, "trip");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signupId).toBe(existing.id);
    expect(result.boardSeat).toBe(true);
    expect(result.amountCents).toBe(0);
  });
});

describe("the roster editor", () => {
  test("ignores board seats instead of refusing to save", async () => {
    const tripId = await createTestTrip({ capacity: 5, resultsReleased: false });
    await withTripLock(tripId, (c) => grantBoardSeats(c, tripId, boardUserId));
    await fill(tripId, 3);

    const riders = (await getSignups(tripId)).filter((r) => r.spot_number !== null);
    expect(riders).toHaveLength(3);

    // The board posts the whole ordering, and a board seat is not in it. If
    // applyRosterAssignment counted them as active this would fail with
    // missing_signup against cards that were never rendered.
    const result = await applyRosterAssignment(tripId, boardUserId, {
      onTrip: [riders[2].id, riders[0].id],
      waitlisted: [riders[1].id],
    });

    expect(result.ok).toBe(true);
    expect(await seats(tripId)).toHaveLength(expectedSeats);
  });
});
