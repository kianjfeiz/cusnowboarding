import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { claimSpot, generatePayToken } from "@/lib/claims/claim";
import { pool } from "@/lib/db";
import { releaseResults } from "@/lib/roster/results";
import { addMemberToTrip } from "@/lib/roster/roster-add";
import { createTestTrip, deleteTestTrips, getMemberIds, getSignups, setupPool } from "./helpers";

let memberIds: string[];
let boardUserId: string;

beforeAll(async () => {
  memberIds = await getMemberIds(20);

  // The audit row and created_by_board_user_id both reference this, and a null
  // actor would let a missing foreign key pass unnoticed.
  const { rows } = await setupPool.query<{ id: string }>(
    `insert into board_users (email, name, is_active)
     values ('roster-add-test@colorado.edu', 'Roster Add Test', true)
     on conflict (email) do update set name = excluded.name
     returning id`,
  );
  boardUserId = rows[0].id;
});

afterAll(async () => {
  await deleteTestTrips();
  // audit_events keeps entity_id as a plain column, so dropping the trips does
  // not take the rows this suite wrote with it - and the actor cannot go while
  // they still point at it.
  await setupPool.query(`delete from audit_events where actor_board_user_id = $1`, [boardUserId]);
  await setupPool.query(`delete from board_users where email = 'roster-add-test@colorado.edu'`);
  await setupPool.end();
  await pool.end();
});

async function fill(tripId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await claimSpot(pool, tripId, memberIds[i], generatePayToken());
  }
  return getSignups(tripId);
}

async function tripRow(tripId: string) {
  const { rows } = await setupPool.query<{
    status: string;
    results_released_at: Date | null;
    roster_finalized_at: Date | null;
    claim_counter: number;
  }>(
    `select status::text as status, results_released_at, roster_finalized_at,
            claim_counter::int as claim_counter
       from trips where id = $1`,
    [tripId],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Sending results is the whole stage change
// ---------------------------------------------------------------------------

describe("releaseResults", () => {
  test("closes signups and finalizes the roster in the same transaction", async () => {
    const tripId = await createTestTrip({
      capacity: 5,
      resultsReleased: false,
    });
    await fill(tripId, 3);

    const before = await tripRow(tripId);
    expect(before.status).toBe("open");
    expect(before.roster_finalized_at).toBeNull();

    const result = await releaseResults(tripId, boardUserId);
    expect(result.ok).toBe(true);

    const after = await tripRow(tripId);
    expect(after.status).toBe("closed");
    expect(after.results_released_at).not.toBeNull();
    // Not a second board action any more. A roster whose results are out but
    // which is not final would leave the attendee list shut with nothing left
    // to open it.
    expect(after.roster_finalized_at).not.toBeNull();
  });

  test("a claim after release is rejected rather than landing on a published roster", async () => {
    const tripId = await createTestTrip({
      capacity: 10,
      resultsReleased: false,
    });
    await fill(tripId, 2);

    await releaseResults(tripId, boardUserId);

    const late = await claimSpot(pool, tripId, memberIds[5], generatePayToken());
    expect(late.outcome).toBe("not_open");
    expect(await getSignups(tripId)).toHaveLength(2);
  });

  test("emails the riders on the trip, not the waitlist", async () => {
    const tripId = await createTestTrip({
      capacity: 2,
      resultsReleased: false,
    });
    await fill(tripId, 3);

    const result = await releaseResults(tripId, null);
    expect(result.ok).toBe(true);

    // Counted from the rows rather than assumed: a seed member who is on the
    // board is comped at release, and board seats are not emailed either.
    const { rows } = await setupPool.query<{
      riders: number;
      waitlisted: number;
    }>(
      `select count(*) filter (where status in ('held','paid') and not board_seat)::int as riders,
              count(*) filter (where status = 'waitlisted')::int as waitlisted
         from signups where trip_id = $1`,
      [tripId],
    );
    expect(rows[0].waitlisted).toBe(1);
    expect(result.emailed).toBe(rows[0].riders);
  });

  test("refuses a second release", async () => {
    const tripId = await createTestTrip({
      capacity: 5,
      resultsReleased: false,
    });
    await fill(tripId, 1);

    expect((await releaseResults(tripId, boardUserId)).ok).toBe(true);

    const again = await releaseResults(tripId, boardUserId);
    expect(again.ok).toBe(false);
    expect(again.reason).toBe("already_released");
  });

  test("refuses a cancelled trip and leaves it as it was", async () => {
    const tripId = await createTestTrip({
      capacity: 5,
      status: "cancelled",
      resultsReleased: false,
    });
    const result = await releaseResults(tripId, boardUserId);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("cancelled");

    // Nobody is emailed about a trip that is not running, and a cancelled trip
    // reported as merely closed would look live again on every board listing.
    const after = await tripRow(tripId);
    expect(after.status).toBe("cancelled");
    expect(after.results_released_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Putting somebody on by hand
// ---------------------------------------------------------------------------

describe("addMemberToTrip", () => {
  test("adds a member who never entered, at the lowest free spot", async () => {
    const tripId = await createTestTrip({ capacity: 5 });
    await fill(tripId, 3);

    const result = await addMemberToTrip(tripId, memberIds[9], boardUserId, "trip");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("held");
    expect(result.spotNumber).toBe(4);
    expect(result.revived).toBe(false);
    expect(result.paymentDeadlineAt).not.toBeNull();

    const rows = await getSignups(tripId);
    expect(rows).toHaveLength(4);
    // Arrival order says what it is: after everyone who raced for it.
    expect(rows[3].claim_seq).toBe(4);
    expect((await tripRow(tripId)).claim_counter).toBe(4);
  });

  test("records who put them there", async () => {
    const tripId = await createTestTrip({ capacity: 5 });
    const result = await addMemberToTrip(tripId, memberIds[0], boardUserId, "trip");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { rows } = await setupPool.query<{
      created_by_board_user_id: string | null;
    }>(`select created_by_board_user_id from signups where id = $1`, [result.signupId]);
    // A spot nobody claimed must never be indistinguishable from one that was
    // won, or the drop log stops being a record of the drop.
    expect(rows[0].created_by_board_user_id).toBe(boardUserId);

    const { rows: audit } = await setupPool.query<{ action: string }>(
      `select action from audit_events where entity_id = $1`,
      [result.signupId],
    );
    expect(audit.map((r) => r.action)).toContain("signup.board_add");
  });

  test("fills a released spot number rather than appending past capacity", async () => {
    const tripId = await createTestTrip({ capacity: 4 });
    const rows = await fill(tripId, 4);

    await setupPool.query(
      `update signups set status = 'expired', spot_number = null, released_at = now(),
              release_reason = 'board_release'
        where id = $1`,
      [rows[1].id],
    );

    const result = await addMemberToTrip(tripId, memberIds[10], boardUserId, "trip");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spotNumber).toBe(2);
  });

  test("adds to the end of the waitlist", async () => {
    const tripId = await createTestTrip({ capacity: 2 });
    await fill(tripId, 4);

    const result = await addMemberToTrip(tripId, memberIds[12], boardUserId, "waitlist");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("waitlisted");
    expect(result.waitlistPosition).toBe(3);
    expect(result.spotNumber).toBeNull();
    expect(result.paymentDeadlineAt).toBeNull();
  });

  test("puts them past capacity on a full trip", async () => {
    // Capacity is a target: the board may run the trip over it.
    const tripId = await createTestTrip({ capacity: 3 });
    await fill(tripId, 3);

    const result = await addMemberToTrip(tripId, memberIds[15], boardUserId, "trip");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("held");
    expect(result.spotNumber).toBe(4);
  });

  test("refuses the waitlist while the drop can still hand out spots", async () => {
    // A board-placed position would collide with one a later claim derives
    // from the counter, and every entrant after that would get an error.
    const tripId = await createTestTrip({
      capacity: 3,
      resultsReleased: false,
    });
    await fill(tripId, 1);

    const result = await addMemberToTrip(tripId, memberIds[15], boardUserId, "waitlist");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("spots_open");
    expect(await getSignups(tripId)).toHaveLength(1);
  });

  test("a waitlist add on a full, still-open trip leaves later claims working", async () => {
    const tripId = await createTestTrip({
      capacity: 2,
      resultsReleased: false,
    });
    await fill(tripId, 3);

    const added = await addMemberToTrip(tripId, memberIds[15], boardUserId, "waitlist");
    expect(added.ok).toBe(true);

    const late = await claimSpot(pool, tripId, memberIds[16], generatePayToken());
    expect(late.outcome).toBe("waitlisted");
    const positions = (await getSignups(tripId))
      .filter((row) => row.status === "waitlisted")
      .map((row) => row.waitlist_position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  test("refuses somebody who is already on the trip or its waitlist", async () => {
    const tripId = await createTestTrip({ capacity: 2 });
    const rows = await fill(tripId, 3);

    const onTrip = await addMemberToTrip(tripId, rows[0].member_id, boardUserId, "trip");
    expect(onTrip.ok).toBe(false);
    if (!onTrip.ok) expect(onTrip.reason).toBe("already_active");

    const waitlisted = await addMemberToTrip(tripId, rows[2].member_id, boardUserId, "trip");
    expect(waitlisted.ok).toBe(false);
    if (!waitlisted.ok) expect(waitlisted.reason).toBe("already_active");
  });

  test("revives a released row instead of writing a second one", async () => {
    const tripId = await createTestTrip({ capacity: 5 });
    const rows = await fill(tripId, 3);
    const dropped = rows[1];

    await setupPool.query(
      `update signups set status = 'expired', spot_number = null, released_at = now(),
              release_reason = 'expired'
        where id = $1`,
      [dropped.id],
    );

    const result = await addMemberToTrip(tripId, dropped.member_id, boardUserId, "trip");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revived).toBe(true);
    expect(result.signupId).toBe(dropped.id);

    // Still three rows, and their arrival order is untouched: a second row
    // would have the drop log claiming this member entered twice.
    const after = await getSignups(tripId);
    expect(after).toHaveLength(3);
    expect(after.map((r) => r.claim_seq)).toEqual([1, 2, 3]);

    const revived = after.find((r) => r.id === dropped.id)!;
    expect(revived.status).toBe("held");

    const { rows: cleared } = await setupPool.query<{
      released_at: Date | null;
      release_reason: string | null;
    }>(`select released_at, release_reason from signups where id = $1`, [dropped.id]);
    expect(cleared[0].released_at).toBeNull();
    expect(cleared[0].release_reason).toBeNull();
  });

  test("reports whether the person has to be told", async () => {
    const open = await createTestTrip({ capacity: 5, resultsReleased: false });
    const beforeRelease = await addMemberToTrip(open, memberIds[0], boardUserId, "trip");
    expect(beforeRelease.ok).toBe(true);
    // Nobody has been told anything yet, so a silent add matches every other
    // pre-release move.
    if (beforeRelease.ok) expect(beforeRelease.resultsReleased).toBe(false);

    const released = await createTestTrip({ capacity: 5 });
    const afterRelease = await addMemberToTrip(released, memberIds[0], boardUserId, "trip");
    expect(afterRelease.ok).toBe(true);
    if (afterRelease.ok) expect(afterRelease.resultsReleased).toBe(true);
  });
});
