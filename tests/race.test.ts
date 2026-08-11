import { describe, test, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { claimSpot, generatePayToken, releaseUnusedSequence } from "@/lib/claims/claim";
import {
  closeClients,
  createTestTrip,
  deleteTestTrips,
  getClaimCounter,
  getMemberIds,
  getSignups,
  makeGate,
  openWarmClients,
  setupPool,
  sortedRange,
} from "./helpers";

const CLAIMERS = 100;
const CAPACITY = 25;

/**
 * Races are probabilistic; a single green run proves nothing. The default is
 * enough to catch a broken statement quickly, and the full soak is:
 *
 *   RACE_ITERATIONS=200 npm run test:race
 */
const ITERATIONS = Number(process.env.RACE_ITERATIONS ?? 25);

let clients: Client[];
let memberIds: string[];

beforeAll(async () => {
  memberIds = await getMemberIds(CLAIMERS);
  clients = await openWarmClients(CLAIMERS);
}, 60_000);

afterAll(async () => {
  await closeClients(clients);
  await deleteTestTrips();
  await setupPool.end();
});

describe("Test A - concurrent burst", () => {
  test(`${CLAIMERS} simultaneous claimers, capacity ${CAPACITY}, x${ITERATIONS}`, async () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const tripId = await createTestTrip({ capacity: CAPACITY, waitlistCap: null });
      const { gate, release } = makeGate();

      const claims = clients.map(async (client, i) => {
        await gate;
        return claimSpot(client, tripId, memberIds[i], generatePayToken());
      });

      release();
      const results = await Promise.all(claims);

      const held = results.filter((r) => r.outcome === "held");
      const waitlisted = results.filter((r) => r.outcome === "waitlisted");
      const other = results.filter(
        (r) => r.outcome !== "held" && r.outcome !== "waitlisted",
      );

      expect(other, `iteration ${iteration}: unexpected outcomes`).toEqual([]);
      expect(held.length, `iteration ${iteration}: held count`).toBe(CAPACITY);
      expect(waitlisted.length, `iteration ${iteration}: waitlisted count`).toBe(
        CLAIMERS - CAPACITY,
      );

      const rows = await getSignups(tripId);
      expect(rows.length).toBe(CLAIMERS);

      // Spot numbers are exactly 1..capacity, so the trip is neither oversold
      // nor undersold.
      const spots = rows
        .filter((r) => r.spot_number !== null)
        .map((r) => r.spot_number!)
        .sort((a, b) => a - b);
      expect(spots, `iteration ${iteration}: spot numbers`).toEqual(sortedRange(CAPACITY));

      // Waitlist positions are contiguous from 1.
      const positions = rows
        .filter((r) => r.waitlist_position !== null)
        .map((r) => r.waitlist_position!)
        .sort((a, b) => a - b);
      expect(positions, `iteration ${iteration}: waitlist positions`).toEqual(
        sortedRange(CLAIMERS - CAPACITY),
      );

      // Arrival order is total and gapless.
      const seqs = rows.map((r) => r.claim_seq).sort((a, b) => a - b);
      expect(seqs, `iteration ${iteration}: claim_seq`).toEqual(sortedRange(CLAIMERS));

      // Ordering is internally consistent: the Nth arrival got the Nth spot,
      // and arrivals past capacity landed at the matching waitlist position.
      for (const row of rows) {
        if (row.claim_seq <= CAPACITY) {
          expect(row.status).toBe("held");
          expect(row.spot_number).toBe(row.claim_seq);
        } else {
          expect(row.status).toBe("waitlisted");
          expect(row.waitlist_position).toBe(row.claim_seq - CAPACITY);
        }
      }

      // No member appears twice.
      expect(new Set(rows.map((r) => r.member_id)).size).toBe(CLAIMERS);

      expect(await getClaimCounter(tripId)).toBe(CLAIMERS);
    }
  });
});

describe("Test B - ordering fidelity", () => {
  test("staggered claims preserve dispatch order", async () => {
    const tripId = await createTestTrip({ capacity: 10, waitlistCap: null });
    const dispatched: string[] = [];

    for (let i = 0; i < 20; i++) {
      dispatched.push(memberIds[i]);
      await claimSpot(clients[i], tripId, memberIds[i], generatePayToken());
      await new Promise((r) => setTimeout(r, 15));
    }

    const rows = await getSignups(tripId);
    expect(rows.map((r) => r.member_id)).toEqual(dispatched);
  });
});

describe("Test C - duplicate storm", () => {
  test("one member claiming 25 times gets exactly one signup", async () => {
    const tripId = await createTestTrip({ capacity: CAPACITY, waitlistCap: null });
    const member = memberIds[0];
    const { gate, release } = makeGate();

    const attempts = clients.slice(0, 25).map(async (client) => {
      await gate;
      return claimSpot(client, tripId, member, generatePayToken());
    });

    release();
    const results = await Promise.all(attempts);

    const rows = await getSignups(tripId);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("held");
    expect(rows[0].spot_number).toBe(rows[0].claim_seq);

    // Exactly one winner; everyone else is told they already have a spot.
    expect(results.filter((r) => r.outcome === "held").length).toBe(1);
    expect(results.filter((r) => r.outcome === "duplicate").length).toBe(24);

    // The documented sequence-gap caveat: losing attempts may consume counter
    // values. Occupancy must still be computed from rows, never the counter.
    const counter = await getClaimCounter(tripId);
    expect(counter).toBeGreaterThanOrEqual(1);
    expect(rows[0].spot_number).toBeLessThanOrEqual(CAPACITY);

    // Any attempt that burned a counter value must report it, so the caller can
    // hand it back. Without this the gap would be invisible and unrecoverable.
    const burned = results.filter(
      (r) => r.outcome !== "held" && r.consumedSeq !== undefined,
    ).length;
    expect(counter).toBe(1 + burned);
  });

  test("releaseUnusedSequence only decrements when it is still the latest", async () => {
    const tripId = await createTestTrip({ capacity: 5, waitlistCap: null });
    await claimSpot(clients[0], tripId, memberIds[0], generatePayToken());
    await claimSpot(clients[1], tripId, memberIds[1], generatePayToken());

    const counter = await getClaimCounter(tripId);
    expect(counter).toBe(2);

    // Stale value: another claim has landed since, so this must not fire.
    expect(await releaseUnusedSequence(setupPool, tripId, 1)).toBe(false);
    expect(await getClaimCounter(tripId)).toBe(2);

    // Current value: safe to give back.
    expect(await releaseUnusedSequence(setupPool, tripId, 2)).toBe(true);
    expect(await getClaimCounter(tripId)).toBe(1);
  });
});

describe("Rejections", () => {
  test("a trip that has not opened rejects claims", async () => {
    const tripId = await createTestTrip({
      status: "scheduled",
      signupOpensAt: "now() + interval '1 hour'",
    });
    const result = await claimSpot(clients[0], tripId, memberIds[0], generatePayToken());
    expect(result.outcome).toBe("not_open");
    expect(await getSignups(tripId)).toEqual([]);
  });

  test("an unverified member cannot claim", async () => {
    const tripId = await createTestTrip({ capacity: 5 });
    const { rows } = await setupPool.query<{ id: string }>(
      `insert into members (email, first_name, last_name)
       values ($1, 'Un', 'Verified') returning id`,
      [`unverified-${Date.now()}@colorado.edu`],
    );
    const result = await claimSpot(clients[0], tripId, rows[0].id, generatePayToken());
    expect(result.outcome).toBe("unverified");
    expect(await getSignups(tripId)).toEqual([]);
    await setupPool.query(`delete from members where id = $1`, [rows[0].id]);
  });

  test("a non-dues-paying member is rejected when the trip requires dues", async () => {
    const tripId = await createTestTrip({ capacity: 5, requiresDues: true });
    const { rows } = await setupPool.query<{ id: string }>(
      `insert into members (email, first_name, last_name, email_verified_at, is_club_member)
       values ($1, 'No', 'Dues', now(), false) returning id`,
      [`nodues-${Date.now()}@colorado.edu`],
    );
    const result = await claimSpot(clients[0], tripId, rows[0].id, generatePayToken());
    expect(result.outcome).toBe("not_member");
    await setupPool.query(`delete from members where id = $1`, [rows[0].id]);
  });

  /*
    The other half of the gate, and the half that is easy to break by accident:
    when a trip does not require dues, owing dues must cost nothing at all. Not a
    waitlist slot instead of a spot, not a different outcome - the same claim
    anyone else gets. A stray `and m.is_club_member` added to member_ok would
    still pass the test above.
  */
  test("a non-dues-paying member claims normally when the trip does not require dues", async () => {
    const tripId = await createTestTrip({ capacity: 5, requiresDues: false });
    const { rows } = await setupPool.query<{ id: string }>(
      `insert into members (email, first_name, last_name, email_verified_at, is_club_member)
       values ($1, 'No', 'Dues', now(), false) returning id`,
      [`nodues-open-${Date.now()}@colorado.edu`],
    );
    const result = await claimSpot(clients[0], tripId, rows[0].id, generatePayToken());
    expect(result.outcome).toBe("held");
    expect(result.signup?.spotNumber).toBe(1);
    await setupPool.query(`delete from signups where member_id = $1`, [rows[0].id]);
    await setupPool.query(`delete from members where id = $1`, [rows[0].id]);
  });

  test("the waitlist cap is enforced under concurrency", async () => {
    const capacity = 5;
    const waitlistCap = 5;
    const tripId = await createTestTrip({ capacity, waitlistCap });
    const { gate, release } = makeGate();

    const claims = clients.slice(0, 40).map(async (client, i) => {
      await gate;
      return claimSpot(client, tripId, memberIds[i], generatePayToken());
    });
    release();
    const results = await Promise.all(claims);

    expect(results.filter((r) => r.outcome === "held").length).toBe(capacity);
    expect(results.filter((r) => r.outcome === "waitlisted").length).toBe(waitlistCap);
    expect(results.filter((r) => r.outcome === "full").length).toBe(40 - capacity - waitlistCap);
    expect((await getSignups(tripId)).length).toBe(capacity + waitlistCap);
  });
});

describe("Test F - crash safety", () => {
  test("a connection killed mid-burst leaves no partial rows", async () => {
    const tripId = await createTestTrip({ capacity: CAPACITY, waitlistCap: null });
    const { gate, release } = makeGate();
    const victims = [3, 11, 27];

    const claims = clients.slice(0, 50).map(async (client, i) => {
      await gate;
      const promise = claimSpot(client, tripId, memberIds[i], generatePayToken()).catch(
        () => ({ outcome: "error" as const }),
      );
      // Sever the socket while the statement is in flight.
      if (victims.includes(i)) {
        setTimeout(() => {
          type WithStream = { connection?: { stream?: { destroy(): void } } };
          (client as unknown as WithStream).connection?.stream?.destroy();
        }, 1);
      }
      return promise;
    });

    release();
    await Promise.all(claims);

    const rows = await getSignups(tripId);

    // Every surviving row is fully formed - single-statement atomicity means a
    // killed connection can never leave a half-written signup.
    for (const row of rows) {
      if (row.status === "held") {
        expect(row.spot_number).not.toBeNull();
        expect(row.waitlist_position).toBeNull();
      } else if (row.status === "waitlisted") {
        expect(row.spot_number).toBeNull();
        expect(row.waitlist_position).not.toBeNull();
      }
    }

    const spots = rows.filter((r) => r.spot_number !== null).map((r) => r.spot_number!);
    expect(new Set(spots).size).toBe(spots.length);
    expect(spots.length).toBeLessThanOrEqual(CAPACITY);

    // Reconnect the clients we destroyed so later tests still have 100 usable ones.
    for (const i of victims) {
      await clients[i].end().catch(() => {});
    }
  });
});

describe("Auto-open", () => {
  test("a scheduled trip whose time has come accepts claims without a manual open", async () => {
    // The manual "open now" step is gone: forgetting it used to fail silently
    // and totally at 8pm. The clock is the authority.
    const tripId = await createTestTrip({ capacity: 5, status: "scheduled" });
    const result = await claimSpot(clients[0], tripId, memberIds[0], generatePayToken());

    expect(result.outcome).toBe("held");
  });

  test("a scheduled trip whose time has NOT come still rejects", async () => {
    const tripId = await createTestTrip({
      capacity: 5,
      status: "scheduled",
      signupOpensAt: "now() + interval '1 hour'",
    });
    const result = await claimSpot(clients[0], tripId, memberIds[0], generatePayToken());

    expect(result.outcome).toBe("not_open");
    expect(await getSignups(tripId)).toEqual([]);
  });

  test("a closed trip rejects even after its open time", async () => {
    const tripId = await createTestTrip({ capacity: 5, status: "closed" });
    const result = await claimSpot(clients[0], tripId, memberIds[0], generatePayToken());

    expect(result.outcome).toBe("not_open");
    expect(await getSignups(tripId)).toEqual([]);
  });

  test("a draft trip rejects", async () => {
    const tripId = await createTestTrip({ capacity: 5, status: "draft" });
    const result = await claimSpot(clients[0], tripId, memberIds[0], generatePayToken());

    expect(result.outcome).toBe("not_open");
    expect(await getSignups(tripId)).toEqual([]);
  });
});
