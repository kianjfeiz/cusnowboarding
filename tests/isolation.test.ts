import { describe, test, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { claimSpot, generatePayToken } from "@/lib/claims/claim";
import {
  closeClients,
  createTestTrip,
  deleteTestTrips,
  getSignups,
  makeGate,
  openWarmClients,
  setupPool,
} from "./helpers";

/**
 * Test E - regression guard.
 *
 * This suite exists to keep a wrong design provably wrong. The obvious way to
 * write a capacity check is:
 *
 *   insert into signups (...)
 *   select ...
 *    where (select count(*) from signups where trip_id = $1) < capacity
 *
 * It reads correct and it passes every single-threaded test. Under concurrency
 * it oversells, because the `count(*)` subquery reads the statement's snapshot
 * rather than taking a predicate lock, so N concurrent statements all observe
 * the same pre-burst count and all insert. Postgres only prevents this at
 * SERIALIZABLE, which then needs an application retry loop whose retry order
 * would destroy the first-come-first-served ordering we are trying to provide.
 *
 * The naive version is exercised against a scratch table with no unique
 * indexes, so what is measured is the isolation hazard itself rather than the
 * backstop indexes on the real `signups` table.
 *
 * If this test ever starts failing, do not delete it - it means the assumptions
 * behind the real claim statement have changed and the whole design needs a
 * fresh look.
 */

const CLAIMERS = 60;
const CAPACITY = 5;

let clients: Client[];
let memberIds: string[];

beforeAll(async () => {
  const { rows } = await setupPool.query<{ id: string }>(
    `select id from members where email_verified_at is not null order by email limit $1`,
    [CLAIMERS],
  );
  memberIds = rows.map((r) => r.id);
  clients = await openWarmClients(CLAIMERS);

  await setupPool.query(`
    create table if not exists naive_signups (
      id      uuid primary key default gen_random_uuid(),
      trip_id uuid not null,
      member_id uuid not null
    )
  `);
}, 60_000);

afterAll(async () => {
  await setupPool.query(`drop table if exists naive_signups`);
  await closeClients(clients);
  await deleteTestTrips();
  await setupPool.end();
});

const NAIVE_SQL = `
insert into naive_signups (trip_id, member_id)
select $1::uuid, $2::uuid
 where (select count(*) from naive_signups where trip_id = $1) <
       (select capacity from trips where id = $1)
returning id
`;

describe("Test E - snapshot isolation hazard", () => {
  test("the count(*) capacity check oversells under concurrency", async () => {
    const tripId = await createTestTrip({ capacity: CAPACITY, waitlistCap: null });
    const { gate, release } = makeGate();

    const attempts = clients.map(async (client, i) => {
      await gate;
      return client.query(NAIVE_SQL, [tripId, memberIds[i]]).catch(() => ({ rows: [] }));
    });
    release();
    await Promise.all(attempts);

    const { rows } = await setupPool.query<{ n: number }>(
      `select count(*)::int as n from naive_signups where trip_id = $1`,
      [tripId],
    );
    const sold = rows[0].n;

    // The whole point: a capacity of 5 does not hold.
    expect(
      sold,
      `expected the naive approach to oversell capacity ${CAPACITY}, but it sold ${sold}`,
    ).toBeGreaterThan(CAPACITY);
  });

  test("the real claim statement does not oversell the same burst", async () => {
    const tripId = await createTestTrip({ capacity: CAPACITY, waitlistCap: null });
    const { gate, release } = makeGate();

    const attempts = clients.map(async (client, i) => {
      await gate;
      return claimSpot(client, tripId, memberIds[i], generatePayToken());
    });
    release();
    const results = await Promise.all(attempts);

    expect(results.filter((r) => r.outcome === "held").length).toBe(CAPACITY);

    const signupRows = await getSignups(tripId);
    const spots = signupRows.filter((r) => r.spot_number !== null).map((r) => r.spot_number!);
    expect(spots.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(signupRows.length).toBe(CLAIMERS);
  });
});
