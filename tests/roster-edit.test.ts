import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { claimSpot, generatePayToken } from "@/lib/claims/claim";
import { pool } from "@/lib/db";
import { applyRosterAssignment } from "@/lib/roster/roster-edit";
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

  test("a claim landing after a demotion joins the waitlist instead of erroring", async () => {
    // Curation runs while signups are still open, and demoting a held rider
    // grows the waitlist without consuming a claim_counter value. The claim
    // statement derives waitlist_position from the counter, so without the
    // counter pin in applyRosterAssignment the next entrant computed a
    // position the demotion already occupied, hit the unique index, was
    // swallowed by `on conflict do nothing`, and got outcome "error" -
    // permanently, because releaseUnusedSequence re-issued the same value.
    const { tripId, rows } = await unreleasedTrip(2, 3);
    const order = ids(rows);

    const result = await applyRosterAssignment(tripId, null, {
      onTrip: [order[0]],
      waitlisted: [order[2], order[1]],
    });
    expect(result.ok).toBe(true);

    const late = await claimSpot(pool, tripId, memberIds[3], generatePayToken());
    expect(late.outcome).toBe("waitlisted");
    if (late.outcome !== "waitlisted") throw new Error("unreachable");
    expect(late.signup.waitlistPosition).toBe(3);

    const positions = (await getSignups(tripId))
      .filter((row) => row.status === "waitlisted")
      .map((row) => row.waitlist_position)
      .sort();
    expect(positions).toEqual([1, 2, 3]);
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

  test("puts more people on the trip than it was slated for when the board says so", async () => {
    const { tripId, rows } = await unreleasedTrip(3, 5);
    const order = ids(rows);

    const result = await applyRosterAssignment(tripId, null, {
      onTrip: order,
      waitlisted: [],
    });

    expect(result.ok).toBe(true);
    expect(result.onTripCount).toBe(5);
    expect(result.capacity).toBe(3);
    await expectWellFormed(tripId, { onTrip: order, waitlisted: [], claimSeqs: seqsOf(rows) });

    // Signups are still open. The next entrant's number is above every spot the
    // board handed out, so they land on the waitlist rather than colliding.
    const late = await claimSpot(pool, tripId, memberIds[5], generatePayToken());
    expect(late.outcome).toBe("waitlisted");
  });

  test("curating a trip that is not full leaves later entrants their spots", async () => {
    // With nobody waitlisted there is no position to protect, so the counter
    // must not be pinned up to capacity - that would waitlist everyone after.
    const { tripId, rows } = await unreleasedTrip(5, 2);
    const order = ids(rows);

    const result = await applyRosterAssignment(tripId, null, {
      onTrip: [order[1], order[0]],
      waitlisted: [],
    });
    expect(result.ok).toBe(true);

    const late = await claimSpot(pool, tripId, memberIds[2], generatePayToken());
    expect(late.outcome).toBe("held");
    if (late.outcome !== "held") throw new Error("unreachable");
    expect(late.signup.spotNumber).toBe(3);
  });

  test("after results are sent, a move up is a promotion with its own payment window", async () => {
    const { tripId, rows } = await unreleasedTrip(3, 4);
    const order = ids(rows);
    await setupPool.query(
      `update trips set results_released_at = now(), roster_finalized_at = now() where id = $1`,
      [tripId],
    );
    await setupPool.query(
      `update signups set payment_deadline_at = now() - interval '1 hour' where id = $1`,
      [order[0]],
    );

    // Everyone on the trip, over capacity: the waitlisted rider comes up.
    const onTrip = [order[0], order[1], order[2], order[3]];
    const result = await applyRosterAssignment(tripId, null, { onTrip, waitlisted: [] });

    expect(result.ok).toBe(true);
    expect(result.released).toBe(true);
    expect(result.movedToTrip).toEqual([order[3]]);
    await expectWellFormed(tripId, { onTrip, waitlisted: [], claimSeqs: seqsOf(rows) });

    const { rows: after } = await setupPool.query<{
      id: string;
      status: string;
      promoted: boolean;
      window_hours: number;
    }>(
      `select id, status::text, promoted_at is not null as promoted,
              round(extract(epoch from payment_deadline_at - now()) / 3600)::int as window_hours
         from signups where id = any($1::uuid[])`,
      [[order[0], order[3]]],
    );
    const promoted = after.find((row) => row.id === order[3])!;
    expect(promoted).toMatchObject({ status: "held", promoted: true, window_hours: 48 });
    // Staying on the trip changes nobody's deadline, lapsed or not.
    const stayed = after.find((row) => row.id === order[0])!;
    expect(stayed).toMatchObject({ promoted: false, window_hours: -1 });
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
