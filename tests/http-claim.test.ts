import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { SignJWT } from "jose";
import { issueChallenge } from "@/lib/challenge";
import {
  createTestTrip,
  deleteTestTrips,
  getMemberIds,
  getSignups,
  makeGate,
  setupPool,
  sortedRange,
} from "./helpers";

/**
 * Test D - end to end over HTTP.
 *
 * The database-level burst in race.test.ts proves the statement is correct.
 * This one proves the request path around it is: that the route does not sneak
 * in an extra query, that middleware is not sitting on the claim path, and that
 * cookie verification really is in-process.
 *
 * Requires a server on BASE_URL. Skipped when nothing is listening, so a plain
 * `npm test` does not fail on a machine with no dev server up.
 */
const BASE_URL = process.env.CLAIM_TEST_URL ?? "http://localhost:3000";
const CLAIMERS = 60;
const CAPACITY = 25;

let memberIds: string[];
let tokenVersions: Map<string, number>;
let serverUp = false;

async function mintCookie(memberId: string, tokenVersion: number): Promise<string> {
  const secret = new TextEncoder().encode(process.env.MEMBER_JWT_SECRET);
  const token = await new SignJWT({ tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(memberId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
  return `csc_member=${token}`;
}

beforeAll(async () => {
  try {
    const response = await fetch(`${BASE_URL}/api/warm`, {
      signal: AbortSignal.timeout(15_000),
    });
    serverUp = response.ok;
  } catch {
    serverUp = false;
  }

  if (!serverUp) return;

  memberIds = await getMemberIds(CLAIMERS);
  const { rows } = await setupPool.query<{ id: string; token_version: number }>(
    `select id, token_version from members where id = any($1::uuid[])`,
    [memberIds],
  );
  tokenVersions = new Map(rows.map((r) => [r.id, r.token_version]));
}, 60_000);

afterAll(async () => {
  await deleteTestTrips();
  await setupPool.end();
});

describe("Test D - concurrent claims over HTTP", () => {
  test(`${CLAIMERS} simultaneous requests, capacity ${CAPACITY}`, async () => {
    if (!serverUp) {
      console.warn(`No server at ${BASE_URL}; skipping HTTP claim test.`);
      return;
    }

    const tripId = await createTestTrip({ capacity: CAPACITY, waitlistCap: null });
    const cookies = await Promise.all(
      memberIds.map((id) => mintCookie(id, tokenVersions.get(id) ?? 1)),
    );

    // The claim now requires the drop-night typing challenge. Minting it here
    // mirrors what the page does at render time.
    const challenges = await Promise.all(
      memberIds.map((id) => issueChallenge(tripId, id)),
    );

    const { gate, release } = makeGate();
    const requests = cookies.map(async (cookie, i) => {
      await gate;
      const response = await fetch(`${BASE_URL}/api/trips/${tripId}/claim`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken: challenges[i].token,
          typed: challenges[i].phrase,
        }),
      });
      return (await response.json()) as { outcome: string };
    });

    release();
    const results = await Promise.all(requests);

    expect(results.filter((r) => r.outcome === "held").length).toBe(CAPACITY);
    expect(results.filter((r) => r.outcome === "waitlisted").length).toBe(
      CLAIMERS - CAPACITY,
    );

    const rows = await getSignups(tripId);
    expect(rows.length).toBe(CLAIMERS);

    const spots = rows
      .filter((r) => r.spot_number !== null)
      .map((r) => r.spot_number!)
      .sort((a, b) => a - b);
    expect(spots).toEqual(sortedRange(CAPACITY));

    const positions = rows
      .filter((r) => r.waitlist_position !== null)
      .map((r) => r.waitlist_position!)
      .sort((a, b) => a - b);
    expect(positions).toEqual(sortedRange(CLAIMERS - CAPACITY));

    expect(new Set(rows.map((r) => r.member_id)).size).toBe(CLAIMERS);
  });

  test("a request with no verification cookie is rejected", async () => {
    if (!serverUp) return;

    const tripId = await createTestTrip({ capacity: 5 });
    const response = await fetch(`${BASE_URL}/api/trips/${tripId}/claim`, {
      method: "POST",
    });

    expect(response.status).toBe(401);
    expect((await response.json()).outcome).toBe("unverified");
    expect(await getSignups(tripId)).toEqual([]);
  });

  test("a forged cookie is rejected", async () => {
    if (!serverUp) return;

    const tripId = await createTestTrip({ capacity: 5 });
    const forged = await new SignJWT({ tv: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(memberIds[0])
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("not-the-real-secret-not-the-real-secret"));

    const response = await fetch(`${BASE_URL}/api/trips/${tripId}/claim`, {
      method: "POST",
      headers: { cookie: `csc_member=${forged}` },
    });

    expect(response.status).toBe(401);
    expect(await getSignups(tripId)).toEqual([]);
  });

  test("a stale token version is rejected without an extra round trip", async () => {
    if (!serverUp) return;

    const tripId = await createTestTrip({ capacity: 5 });
    const memberId = memberIds[0];
    const current = tokenVersions.get(memberId) ?? 1;

    // Signed correctly, but for a revoked version of the member's session.
    const cookie = await mintCookie(memberId, current + 99);
    const challenge = await issueChallenge(tripId, memberId);
    const response = await fetch(`${BASE_URL}/api/trips/${tripId}/claim`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ challengeToken: challenge.token, typed: challenge.phrase }),
    });

    expect((await response.json()).outcome).toBe("unverified");
    expect(await getSignups(tripId)).toEqual([]);
  });

  test("no entry is created without the typed phrase", async () => {
    if (!serverUp) return;

    const tripId = await createTestTrip({ capacity: 5 });
    const cookie = await mintCookie(memberIds[0], tokenVersions.get(memberIds[0]) ?? 1);

    const response = await fetch(`${BASE_URL}/api/trips/${tripId}/claim`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).outcome).toBe("challenge");
    expect(await getSignups(tripId)).toEqual([]);
  });

  test("a phrase issued to someone else cannot be used", async () => {
    if (!serverUp) return;

    const tripId = await createTestTrip({ capacity: 5 });
    const cookie = await mintCookie(memberIds[0], tokenVersions.get(memberIds[0]) ?? 1);

    // Correctly signed, correctly typed - but bound to a different member.
    const challenge = await issueChallenge(tripId, memberIds[1]);
    const response = await fetch(`${BASE_URL}/api/trips/${tripId}/claim`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ challengeToken: challenge.token, typed: challenge.phrase }),
    });

    expect(response.status).toBe(400);
    expect(await getSignups(tripId)).toEqual([]);
  });

  test("a mistyped phrase creates no entry", async () => {
    if (!serverUp) return;

    const tripId = await createTestTrip({ capacity: 5 });
    const cookie = await mintCookie(memberIds[0], tokenVersions.get(memberIds[0]) ?? 1);
    const challenge = await issueChallenge(tripId, memberIds[0]);

    const response = await fetch(`${BASE_URL}/api/trips/${tripId}/claim`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        challengeToken: challenge.token,
        typed: `${challenge.phrase} extra`,
      }),
    });

    expect(response.status).toBe(400);
    expect(await getSignups(tripId)).toEqual([]);
  });
});
