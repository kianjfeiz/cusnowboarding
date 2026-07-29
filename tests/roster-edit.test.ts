import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { claimSpot, generatePayToken } from "@/lib/claims/claim";
import { pool } from "@/lib/db";
import { applyRosterAssignment } from "@/lib/roster-edit";
import {
  createTestTrip,
  deleteTestTrips,
  getMemberIds,
  getSignups,
  setupPool,
  sortedRange,
  type SignupRow,
} from "./helpers";

let memberIds: string[];

beforeAll(async () => {
  memberIds = await getMemberIds(20);
});

afterAll(async () => {
  await deleteTestTrips();
  await setupPool.end();
  await pool.end();
});

/**
 * The editor is a pre-release tool, so every fixture starts unreleased. The
 * helper defaults the other way because most suites test post-release behaviour.
 */
async function unreleasedTrip(capacity: number, count: number) {
  const tripId = await createTestTrip({
    capacity,
    waitlistCap: null,
    resultsReleased: false,
  });
  for (let i = 0; i < count; i++) {
    await claimSpot(pool, tripId, memberIds[i], generatePayToken());
  }
  return { tripId, rows: await getSignups(tripId) };
}

const ids = (rows: SignupRow[]) => rows.map((row) => row.id);

/**
 * The invariants that make the roster representable at all: dense spot numbers,
 * dense waitlist positions, and arrival order untouched. Asserted after every
 * successful apply rather than only where it feels risky, because the whole
 * point of the offset rewrite is that it must never leave a gap or a duplicate.
 */
async function expectWellFormed(
  tripId: string,
  expected: { onTrip: string[]; waitlisted: string[]; claimSeqs: Map<string, number> },
) {
  const after = await getSignups(tripId);

  const onTrip = after
    .filter((row) => row.spot_number !== null)
    .sort((a, b) => a.spot_number! - b.spot_number!);
  expect(onTrip.map((row) => row.spot_number)).toEqual(sortedRange(expected.onTrip.length));
  expect(onTrip.map((row) => row.id)).toEqual(expected.onTrip);
  expect(onTrip.every((row) => row.waitlist_position === null)).toBe(true);
  expect(onTrip.every((row) => ["held", "paid"].includes(row.status))).toBe(true);

  const waitlisted = after
    .filter((row) => row.status === "waitlisted")
    .sort((a, b) => a.waitlist_position! - b.waitlist_position!);
  expect(waitlisted.map((row) => row.waitlist_position)).toEqual(
    sortedRange(expected.waitlisted.length),
  );
  expect(waitlisted.map((row) => row.id)).toEqual(expected.waitlisted);
  expect(waitlisted.every((row) => row.spot_number === null)).toBe(true);

  for (const row of after) {
    expect(row.claim_seq).toBe(expected.claimSeqs.get(row.id));
  }
}

const seqsOf = (rows: SignupRow[]) => new Map(rows.map((row) => [row.id, row.claim_seq]));

describe("roster editing", () => {
  test("reorders the trip without touching who is on it", async () => {
    const { tripId, rows } = await unreleasedTrip(4, 4);
    const order = ids(rows);
    const shuffled = [order[3], order[0], order[2], order[1]];

    const result = await applyRosterAssignment(tripId, null, {
      onTrip: shuffled,
      waitlisted: [],
    });

    expect(result.ok).toBe(true);
    expect(result.movedToTrip).toEqual([]);
    expect(result.movedToWaitlist).toEqual([]);

    await expectWellFormed(tripId, {
      onTrip: shuffled,
      waitlisted: [],
      claimSeqs: seqsOf(rows),
    });
  });

  test("pulls someone up off the waitlist and drops someone else down", async () => {
    const { tripId, rows } = await unreleasedTrip(3, 6);
    const order = ids(rows);

    // Arrival order gave spots to 1-3. The coordinator wants #5 instead of #2.
    const onTrip = [order[0], order[4], order[2]];
    const waitlisted = [order[1], order[3], order[5]];

    const result = await applyRosterAssignment(tripId, null, { onTrip, waitlisted });

    expect(result.ok).toBe(true);
    expect(result.movedToTrip).toEqual([order[4]]);
    expect(result.movedToWaitlist).toEqual([order[1]]);

    await expectWellFormed(tripId, { onTrip, waitlisted, claimSeqs: seqsOf(rows) });

    // A row arriving from the waitlist has to satisfy signups_held_has_deadline.
    const promoted = (await getSignups(tripId)).find((row) => row.id === order[4])!;
    expect(promoted.status).toBe("held");
    const { rows: deadline } = await setupPool.query<{ has: boolean }>(
      `select payment_deadline_at is not null as has from signups where id = $1`,
      [order[4]],
    );
    expect(deadline[0].has).toBe(true);

    // And a row sent down keeps nothing that would let it look like a hold.
    const demoted = (await getSignups(tripId)).find((row) => row.id === order[1])!;
    expect(demoted.status).toBe("waitlisted");
    expect(demoted.spot_number).toBeNull();
  });

  test("a full swap of the two lists still lands on dense numbering", async () => {
    // The case the offset rewrite exists for: every position is taken by a
    // different row, so a single UPDATE would collide with itself.
    const { tripId, rows } = await unreleasedTrip(3, 6);
    const order = ids(rows);
    const onTrip = [order[5], order[4], order[3]];
    const waitlisted = [order[2], order[1], order[0]];

    const result = await applyRosterAssignment(tripId, null, { onTrip, waitlisted });

    expect(result.ok).toBe(true);
    await expectWellFormed(tripId, { onTrip, waitlisted, claimSeqs: seqsOf(rows) });
  });

  test("refuses when more people are on the trip than there are spots", async () => {
    const { tripId, rows } = await unreleasedTrip(3, 5);
    const order = ids(rows);

    const result = await applyRosterAssignment(tripId, null, {
      onTrip: order,
      waitlisted: [],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("over_capacity");
    expect(result.capacity).toBe(3);
    expect(result.onTripCount).toBe(5);

    // Refusal leaves the drop's allocation exactly as it was.
    await expectWellFormed(tripId, {
      onTrip: order.slice(0, 3),
      waitlisted: order.slice(3),
      claimSeqs: seqsOf(rows),
    });
  });

  test("refuses once results have been sent", async () => {
    const { tripId, rows } = await unreleasedTrip(3, 4);
    const order = ids(rows);
    await setupPool.query(`update trips set results_released_at = now() where id = $1`, [
      tripId,
    ]);

    const result = await applyRosterAssignment(tripId, null, {
      onTrip: [order[3], order[1], order[2]],
      waitlisted: [order[0]],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already_released");

    await expectWellFormed(tripId, {
      onTrip: order.slice(0, 3),
      waitlisted: order.slice(3),
      claimSeqs: seqsOf(rows),
    });
  });

  test("refuses to move a paid signup to the waitlist", async () => {
    const { tripId, rows } = await unreleasedTrip(3, 4);
    const order = ids(rows);
    await setupPool.query(
      `update signups set status = 'paid', paid_at = now() where id = $1`,
      [order[1]],
    );

    const result = await applyRosterAssignment(tripId, null, {
      onTrip: [order[0], order[2], order[3]],
      waitlisted: [order[1]],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("cannot_move_paid");
    expect(result.signupId).toBe(order[1]);
    expect(result.signupName).toBeTruthy();
  });

  test("a paid signup can still be reordered on the trip", async () => {
    const { tripId, rows } = await unreleasedTrip(3, 3);
    const order = ids(rows);
    await setupPool.query(
      `update signups set status = 'paid', paid_at = now() where id = $1`,
      [order[0]],
    );

    const onTrip = [order[2], order[1], order[0]];
    const result = await applyRosterAssignment(tripId, null, { onTrip, waitlisted: [] });

    expect(result.ok).toBe(true);
    await expectWellFormed(tripId, { onTrip, waitlisted: [], claimSeqs: seqsOf(rows) });

    const paid = (await getSignups(tripId)).find((row) => row.id === order[0])!;
    expect(paid.status).toBe("paid");
    expect(paid.spot_number).toBe(3);
  });

  test("refuses when someone active is left out of both lists", async () => {
    const { tripId, rows } = await unreleasedTrip(3, 5);
    const order = ids(rows);

    const result = await applyRosterAssignment(tripId, null, {
      onTrip: order.slice(0, 3),
      waitlisted: [order[3]],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_signup");
    expect(result.signupId).toBe(order[4]);
  });

  test("refuses an id that does not belong to this trip", async () => {
    const { tripId, rows } = await unreleasedTrip(3, 3);
    const other = await unreleasedTrip(3, 1);
    const order = ids(rows);

    const result = await applyRosterAssignment(tripId, null, {
      onTrip: [...order, other.rows[0].id],
      waitlisted: [],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown_signup");
    expect(result.signupId).toBe(other.rows[0].id);
  });

  test("refuses a signup listed twice", async () => {
    const { tripId, rows } = await unreleasedTrip(3, 3);
    const order = ids(rows);

    const result = await applyRosterAssignment(tripId, null, {
      onTrip: [order[0], order[1]],
      waitlisted: [order[2], order[0]],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("duplicate_signup");
    expect(result.signupId).toBe(order[0]);
  });

  test("writes one audit row naming who moved between the lists", async () => {
    const { tripId, rows } = await unreleasedTrip(2, 4);
    const order = ids(rows);

    await applyRosterAssignment(tripId, null, {
      onTrip: [order[0], order[3]],
      waitlisted: [order[1], order[2]],
    });

    const { rows: audit } = await setupPool.query<{
      action: string;
      data: { movedToTrip: string[]; movedToWaitlist: string[] };
    }>(
      `select action, data from audit_events
        where entity_type = 'trip' and entity_id = $1
        order by created_at desc`,
      [tripId],
    );

    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("trip.roster_reordered");
    expect(audit[0].data.movedToTrip).toEqual([order[3]]);
    expect(audit[0].data.movedToWaitlist).toEqual([order[1]]);
  });

  test("two saves racing cannot produce a duplicate spot number", async () => {
    const { tripId, rows } = await unreleasedTrip(3, 6);
    const order = ids(rows);

    const first = {
      onTrip: [order[0], order[3], order[4]],
      waitlisted: [order[1], order[2], order[5]],
    };
    const second = {
      onTrip: [order[5], order[2], order[1]],
      waitlisted: [order[0], order[3], order[4]],
    };

    const results = await Promise.all([
      applyRosterAssignment(tripId, null, first),
      applyRosterAssignment(tripId, null, second),
    ]);

    // Both operate on the same set of people, so both are legitimate; the trip
    // row lock serialises them and the last one committed is what stands.
    expect(results.every((r) => r.ok)).toBe(true);

    const after = await getSignups(tripId);
    const spots = after.filter((r) => r.spot_number !== null).map((r) => r.spot_number!);
    expect(spots.slice().sort((a, b) => a - b)).toEqual(sortedRange(3));

    const positions = after
      .filter((r) => r.status === "waitlisted")
      .map((r) => r.waitlist_position!);
    expect(positions.slice().sort((a, b) => a - b)).toEqual(sortedRange(3));

    const winner = [first, second].find(
      (candidate) =>
        candidate.onTrip.every(
          (id, i) => after.find((row) => row.id === id)?.spot_number === i + 1,
        ),
    );
    expect(winner).toBeDefined();

    for (const row of after) {
      expect(row.claim_seq).toBe(seqsOf(rows).get(row.id));
    }
  });
});
