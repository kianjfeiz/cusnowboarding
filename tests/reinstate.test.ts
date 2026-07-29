import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { claimSpot, generatePayToken } from "@/lib/claims/claim";
import { pool } from "@/lib/db";
import { reinstateSignup } from "@/lib/reinstate";
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

/** Releases a hold outright, as the reaper or a board release would. */
async function release(signupId: string) {
  await setupPool.query(
    `update signups
        set status = 'expired', spot_number = null, released_at = now(),
            release_reason = 'expired', updated_at = now()
      where id = $1`,
    [signupId],
  );
}

/** Publishes results, which is what makes lapsed holds reapable at all. */
async function releaseResults(tripId: string) {
  await setupPool.query(
    `update trips set results_released_at = now() where id = $1`,
    [tripId],
  );
}

async function statusOf(signupId: string) {
  const { rows } = await setupPool.query<{
    status: string;
    spot_number: number | null;
    paid_at: Date | null;
    paid_offline: boolean;
    offline_note: string | null;
    released_at: Date | null;
    payment_deadline_at: Date | null;
  }>(
    `select status::text as status, spot_number, paid_at, paid_offline, offline_note,
            released_at, payment_deadline_at
       from signups where id = $1`,
    [signupId],
  );
  return rows[0];
}

async function paymentsFor(signupId: string) {
  const { rows } = await setupPool.query<{
    provider: string;
    reference: string | null;
    amount_cents: number;
    status: string;
    paid_at: Date | null;
    note: string | null;
  }>(
    `select provider, reference, amount_cents, status::text as status, paid_at, note
       from payments where signup_id = $1 order by created_at`,
    [signupId],
  );
  return rows;
}

describe("reinstating a released signup", () => {
  test("puts an expired signup back into the lowest free spot", async () => {
    const tripId = await createTestTrip({ capacity: 3, waitlistCap: null });
    const rows = await fill(tripId, 3);
    await release(rows[1].id); // frees spot 2

    const result = await reinstateSignup(rows[1].id, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.spotNumber).toBe(2);
    expect(result.status).toBe("held");

    const after = await statusOf(rows[1].id);
    expect(after.status).toBe("held");
    expect(after.spot_number).toBe(2);
    expect(after.paid_at).toBeNull();
    // A fresh window, not the dead one it was released on.
    expect(after.payment_deadline_at!.getTime()).toBeGreaterThan(Date.now());
    // The row is live again, so nothing may still read it as released.
    expect(after.released_at).toBeNull();

    // claim_seq is arrival history and is never rewritten.
    const all = await getSignups(tripId);
    expect(all.find((r) => r.id === rows[1].id)!.claim_seq).toBe(2);
  });

  test("writes an audit event naming the spot it went into", async () => {
    const tripId = await createTestTrip({ capacity: 2, waitlistCap: null });
    const rows = await fill(tripId, 1);
    await release(rows[0].id);

    await reinstateSignup(rows[0].id, null);

    const { rows: audit } = await setupPool.query<{ action: string; data: { spotNumber: number } }>(
      `select action, data from audit_events
        where entity_type = 'signup' and entity_id = $1 and action = 'signup.reinstate'`,
      [rows[0].id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].data.spotNumber).toBe(1);
  });

  test("refuses when the trip is full", async () => {
    const tripId = await createTestTrip({ capacity: 2, waitlistCap: null });
    const rows = await fill(tripId, 3);
    await release(rows[0].id);

    // Someone else takes the freed spot before the treasurer gets there.
    await setupPool.query(
      `update signups set status = 'held', spot_number = 1,
                          waitlist_position = null,
                          payment_deadline_at = now() + interval '48 hours'
        where id = $1`,
      [rows[2].id],
    );

    const result = await reinstateSignup(rows[0].id, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_free_spot");

    // Refusing means refusing: nothing was written.
    expect((await statusOf(rows[0].id)).status).toBe("expired");
  });

  test("refuses a signup that is still held", async () => {
    const tripId = await createTestTrip({ capacity: 3, waitlistCap: null });
    const rows = await fill(tripId, 1);

    const result = await reinstateSignup(rows[0].id, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_reinstatable");
  });

  test("refuses when the member already has a newer live signup on the trip", async () => {
    const tripId = await createTestTrip({ capacity: 3, waitlistCap: null });
    const rows = await fill(tripId, 1);
    await release(rows[0].id);

    // The member gave up waiting and claimed again.
    await claimSpot(pool, tripId, memberIds[0], generatePayToken());

    const result = await reinstateSignup(rows[0].id, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_reinstatable");
  });

  test("the paid variant lands on paid with the offline note recorded", async () => {
    const tripId = await createTestTrip({ capacity: 3, waitlistCap: null });
    const rows = await fill(tripId, 1);
    await release(rows[0].id);

    const result = await reinstateSignup(rows[0].id, null, {
      markPaid: true,
      provider: "venmo",
      note: "12 Jan",
      offlineNote: "Venmo, 12 Jan",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("paid");

    const after = await statusOf(rows[0].id);
    expect(after.status).toBe("paid");
    expect(after.spot_number).toBe(1);
    expect(after.paid_at).not.toBeNull();
    expect(after.paid_offline).toBe(true);
    expect(after.offline_note).toBe("Venmo, 12 Jan");
  });

  /**
   * Reinstating as paid is the treasurer saying the money is in hand. Without a
   * payments row beside it there is nothing to reconcile against later, and the
   * signup is a bare assertion.
   */
  test("the paid variant records where the money came from", async () => {
    const tripId = await createTestTrip({ capacity: 3, waitlistCap: null });
    const rows = await fill(tripId, 1);
    await release(rows[0].id);

    await reinstateSignup(rows[0].id, null, {
      markPaid: true,
      provider: "fusion",
      reference: "FUS-9911",
      note: "Reconciled from the January export",
    });

    const payments = await paymentsFor(rows[0].id);
    expect(payments).toHaveLength(1);
    expect(payments[0].provider).toBe("fusion");
    expect(payments[0].reference).toBe("FUS-9911");
    expect(payments[0].status).toBe("paid");
    expect(payments[0].amount_cents).toBe(8500);
    // The two timestamps are read off the same transaction clock on purpose:
    // a payment dated apart from the signup it settles is unreconcilable.
    expect(payments[0].paid_at!.getTime()).toBe(
      (await statusOf(rows[0].id)).paid_at!.getTime(),
    );
  });

  test("reinstating into a fresh payment window records no payment", async () => {
    const tripId = await createTestTrip({ capacity: 3, waitlistCap: null });
    const rows = await fill(tripId, 1);
    await release(rows[0].id);

    await reinstateSignup(rows[0].id, null);

    expect(await paymentsFor(rows[0].id)).toHaveLength(0);
  });

  test("marking paid with no detail still defaults to Fusion", async () => {
    // Nothing observes money any more, so paid_offline follows the decision to
    // record a payment rather than the source it came from.
    const tripId = await createTestTrip({ capacity: 3, waitlistCap: null });
    const rows = await fill(tripId, 1);
    await release(rows[0].id);

    await reinstateSignup(rows[0].id, null, { markPaid: true });

    const after = await statusOf(rows[0].id);
    expect(after.status).toBe("paid");
    expect(after.paid_offline).toBe(true);

    const payments = await paymentsFor(rows[0].id);
    expect(payments).toHaveLength(1);
    expect(payments[0].provider).toBe("fusion");
    expect(payments[0].reference).toBeNull();
  });

  test("reclaims the spot of a lapsed hold the cron has not reaped yet", async () => {
    const tripId = await createTestTrip({ capacity: 2, waitlistCap: null });
    const rows = await fill(tripId, 2);
    await release(rows[0].id);

    // Nothing is reapable on a trip whose results are still unpublished, so
    // this has to be a trip the members have actually been told about.
    await releaseResults(tripId);

    // Spot 2 is still physically held by a row whose deadline is long gone.
    await setupPool.query(
      `update signups set payment_deadline_at = now() - interval '30 minutes' where id = $1`,
      [rows[1].id],
    );

    // Deliberately no releaseLapsedHolds call: reinstating must not depend on
    // the cron having run.
    const result = await reinstateSignup(rows[0].id, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spotNumber).toBe(1);

    expect((await statusOf(rows[1].id)).status).toBe("expired");
  });

  test("concurrent reinstates cannot both take the same spot", async () => {
    const tripId = await createTestTrip({ capacity: 2, waitlistCap: null });
    const rows = await fill(tripId, 2);
    await release(rows[0].id);
    await release(rows[1].id);

    // Refill one spot so exactly one is free for the two callers to fight over.
    await setupPool.query(
      `insert into signups (trip_id, member_id, claim_seq, status, spot_number,
                            payment_deadline_at, pay_token, amount_cents)
       values ($1, $2, 99, 'held', 1, now() + interval '48 hours', $3, 8500)`,
      [tripId, memberIds[5], `test-token-${tripId}`],
    );

    const results = await Promise.all([
      reinstateSignup(rows[0].id, null),
      reinstateSignup(rows[1].id, null),
    ]);

    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => !r.ok && r.reason === "no_free_spot").length).toBe(1);

    const after = await getSignups(tripId);
    const spots = after.filter((r) => r.spot_number !== null).map((r) => r.spot_number!);
    expect(new Set(spots).size).toBe(spots.length);
    expect(spots.length).toBe(2);
  });
});
