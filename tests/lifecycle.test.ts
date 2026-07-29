import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { claimSpot, generatePayToken } from "@/lib/claims/claim";
import { pool } from "@/lib/db";
import {
  promoteFromWaitlist,
  releaseLapsedHolds,
  renumberWaitlist,
  withTripLock,
} from "@/lib/promotion";
import { getOccupancy } from "@/lib/trips";
import {
  createTestTrip,
  deleteTestTrips,
  getMemberIds,
  getSignups,
  setupPool,
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

/** Fills a trip and returns the resulting signups in arrival order. */
async function fill(tripId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await claimSpot(pool, tripId, memberIds[i], generatePayToken());
  }
  return getSignups(tripId);
}

/** Pushes a hold's deadline into the past so the reaper will pick it up. */
async function lapse(signupId: string, minutesAgo = 30) {
  await setupPool.query(
    `update signups
        set payment_deadline_at = now() - make_interval(mins => $2::int)
      where id = $1`,
    [signupId, minutesAgo],
  );
}

describe("expiry", () => {
  test("a lapsed hold is released and frees its spot number", async () => {
    const tripId = await createTestTrip({ capacity: 3, waitlistCap: null });
    const rows = await fill(tripId, 3);
    await lapse(rows[1].id);

    const released = await releaseLapsedHolds(pool, tripId);
    expect(released.map((r) => r.id)).toEqual([rows[1].id]);

    const after = await getSignups(tripId);
    const expired = after.find((r) => r.id === rows[1].id)!;
    expect(expired.status).toBe("expired");
    expect(expired.spot_number).toBeNull();

    // claim_seq survives as the permanent arrival record even after release.
    expect(expired.claim_seq).toBe(2);
  });

  test("a hold on an unreleased trip is never reaped", async () => {
    // Nobody has been told they have a spot yet, so the deadline they would be
    // measured against is one they could not have acted on. Releasing results
    // is what restarts the clock.
    const tripId = await createTestTrip({
      capacity: 3,
      waitlistCap: null,
      resultsReleased: false,
    });
    const rows = await fill(tripId, 1);
    await lapse(rows[0].id);

    expect(await releaseLapsedHolds(pool, tripId)).toEqual([]);

    // Once results go out, the same hold becomes reapable.
    await setupPool.query(
      `update trips set results_released_at = now() where id = $1`,
      [tripId],
    );
    expect((await releaseLapsedHolds(pool, tripId)).map((r) => r.id)).toEqual([rows[0].id]);
  });

  test("the 10 minute grace protects a hold that just lapsed", async () => {
    const tripId = await createTestTrip({ capacity: 3, waitlistCap: null });
    const rows = await fill(tripId, 1);
    await lapse(rows[0].id, 2);

    expect(await releaseLapsedHolds(pool, tripId)).toEqual([]);
  });

  test("a hold with a recorded payment is never reaped", async () => {
    const tripId = await createTestTrip({ capacity: 3, waitlistCap: null });
    const rows = await fill(tripId, 1);
    await lapse(rows[0].id);

    await setupPool.query(
      `insert into payments (signup_id, amount_cents, status, provider, paid_at)
       values ($1, 8500, 'paid', 'fusion', now())`,
      [rows[0].id],
    );

    // Money settles outside this app, so a recorded payment is the strongest
    // evidence available that someone paid. Releasing their spot anyway would
    // be the worst thing this job could do.
    expect(await releaseLapsedHolds(pool, tripId)).toEqual([]);
  });

  test("occupancy applies lazy expiry before the cron runs", async () => {
    const tripId = await createTestTrip({ capacity: 3, waitlistCap: null });
    const rows = await fill(tripId, 3);
    await lapse(rows[0].id);

    // No reaper run here on purpose.
    const occupancy = await getOccupancy(tripId, 3);
    expect(occupancy.taken).toBe(2);
    expect(occupancy.free).toBe(1);
  });
});

describe("waitlist promotion", () => {
  test("promotes into a freed spot and renumbers the waitlist", async () => {
    const tripId = await createTestTrip({ capacity: 2, waitlistCap: null });
    const rows = await fill(tripId, 5);

    const waitlisted = rows.filter((r) => r.status === "waitlisted");
    expect(waitlisted.map((r) => r.waitlist_position)).toEqual([1, 2, 3]);

    await lapse(rows[0].id);
    await releaseLapsedHolds(pool, tripId);

    const result = await promoteFromWaitlist(waitlisted[0].id, null);
    expect(result.ok).toBe(true);
    expect(result.spotNumber).toBe(1); // the spot that was freed

    const after = await getSignups(tripId);
    const promoted = after.find((r) => r.id === waitlisted[0].id)!;
    expect(promoted.status).toBe("held");
    expect(promoted.spot_number).toBe(1);
    expect(promoted.waitlist_position).toBeNull();
    expect(promoted.claim_seq).toBe(3); // arrival order is never rewritten

    // Remaining waitlisters close ranks, still ordered by arrival.
    const remaining = after
      .filter((r) => r.status === "waitlisted")
      .sort((a, b) => a.claim_seq - b.claim_seq);
    expect(remaining.map((r) => r.waitlist_position)).toEqual([1, 2]);
    expect(remaining.map((r) => r.claim_seq)).toEqual([4, 5]);
  });

  test("promotion self-heals a lapsed hold the cron has not reaped yet", async () => {
    const tripId = await createTestTrip({ capacity: 2, waitlistCap: null });
    const rows = await fill(tripId, 3);
    await lapse(rows[1].id);

    // Deliberately no releaseLapsedHolds call: the board should be able to
    // promote off a lapsed hold without waiting for the cron.
    const waitlisted = rows.find((r) => r.status === "waitlisted")!;
    const result = await promoteFromWaitlist(waitlisted.id, null);

    expect(result.ok).toBe(true);
    expect(result.spotNumber).toBe(2);
  });

  test("refuses when no spot is genuinely free", async () => {
    const tripId = await createTestTrip({ capacity: 2, waitlistCap: null });
    const rows = await fill(tripId, 4);
    const waitlisted = rows.find((r) => r.status === "waitlisted")!;

    const result = await promoteFromWaitlist(waitlisted.id, null);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_free_spot");
  });

  test("concurrent promotions cannot both take the same spot", async () => {
    const tripId = await createTestTrip({ capacity: 2, waitlistCap: null });
    const rows = await fill(tripId, 6);

    await lapse(rows[0].id);
    await releaseLapsedHolds(pool, tripId);

    const waitlisted = rows.filter((r) => r.status === "waitlisted");
    const results = await Promise.all([
      promoteFromWaitlist(waitlisted[0].id, null),
      promoteFromWaitlist(waitlisted[1].id, null),
    ]);

    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => r.reason === "no_free_spot").length).toBe(1);

    const after = await getSignups(tripId);
    const spots = after.filter((r) => r.spot_number !== null).map((r) => r.spot_number!);
    expect(new Set(spots).size).toBe(spots.length);
    expect(spots.length).toBe(2);
  });

  test("cancelling a waitlister closes the gap in the numbering", async () => {
    const tripId = await createTestTrip({ capacity: 2, waitlistCap: null });
    const rows = await fill(tripId, 6);
    const waitlisted = rows
      .filter((r) => r.status === "waitlisted")
      .sort((a, b) => a.claim_seq - b.claim_seq);
    expect(waitlisted.map((r) => r.waitlist_position)).toEqual([1, 2, 3, 4]);

    // Cancel the second waitlister, the way the board action does.
    await withTripLock(tripId, async (client) => {
      await client.query(
        `update signups
            set status = 'cancelled', spot_number = null, waitlist_position = null,
                released_at = now(), release_reason = 'board_cancel', updated_at = now()
          where id = $1`,
        [waitlisted[1].id],
      );
      await renumberWaitlist(client, tripId);
    });

    const after = (await getSignups(tripId))
      .filter((r) => r.status === "waitlisted")
      .sort((a, b) => a.claim_seq - b.claim_seq);

    // Contiguous again, and still in arrival order rather than renumbered by
    // anything the board did.
    expect(after.map((r) => r.waitlist_position)).toEqual([1, 2, 3]);
    expect(after.map((r) => r.claim_seq)).toEqual([3, 5, 6]);
  });

  test("refuses to promote a signup that is not waitlisted", async () => {
    const tripId = await createTestTrip({ capacity: 3, waitlistCap: null });
    const rows = await fill(tripId, 1);

    const result = await promoteFromWaitlist(rows[0].id, null);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_waitlisted");
  });
});
