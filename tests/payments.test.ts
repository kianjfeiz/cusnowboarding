import { describe, test, expect, afterAll } from "vitest";
import { claimSpot } from "@/lib/claims/claim";
import { pool } from "@/lib/db";
import { HOLD_GRACE_MINUTES } from "@/lib/holds";
import { classify, loadPayState, type PaySignup } from "@/lib/payments";
import { createTestTrip, deleteTestTrips, getMemberIds, setupPool } from "./helpers";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

afterAll(async () => {
  await deleteTestTrips();
  await setupPool.end();
  await pool.end();
});

const base: PaySignup = {
  id: "00000000-0000-0000-0000-000000000000",
  payToken: "t",
  status: "held",
  spotNumber: 3,
  paymentDeadlineAt: null,
  paidAt: null,
  amountCents: 8500,
  paidOffline: false,
  offlineNote: null,
  email: "rider@colorado.edu",
  firstName: "Rider",
  tripId: "00000000-0000-0000-0000-000000000001",
  memberId: "00000000-0000-0000-0000-000000000002",
  tripTitle: "Test",
  tripSlug: "test",
  resort: null,
  departAt: new Date(),
  returnAt: null,
  paymentUrl: null,
  resultsReleased: true,
};

const now = new Date("2026-01-10T12:00:00Z");

/** Shorthand for a hold whose deadline sits `ms` from `now`. */
const deadlineIn = (ms: number): PaySignup => ({
  ...base,
  paymentDeadlineAt: new Date(now.getTime() + ms),
});

describe("before results are released", () => {
  /**
   * Nothing is revealed until the board publishes. A member who entered the
   * drop has been told only that their entry was received, so neither a spot
   * nor a bill may leak out of this screen before then.
   */
  test("a held spot reads as pending, not due", () => {
    const state = classify(
      { ...deadlineIn(HOUR), resultsReleased: false },
      now,
    );
    expect(state.kind).toBe("pending");
  });

  test("a waitlisted entry reads as pending too", () => {
    const state = classify(
      { ...base, status: "waitlisted", spotNumber: null, resultsReleased: false },
      now,
    );
    expect(state.kind).toBe("pending");
  });

  /**
   * The deadline resets when results go out, so a hold that lapsed before the
   * board published is not the member's fault and must not read as lapsed.
   */
  test("a passed deadline is still pending while results are unreleased", () => {
    const state = classify(
      { ...deadlineIn(-2 * HOUR), resultsReleased: false },
      now,
    );
    expect(state.kind).toBe("pending");
  });

  test("money already recorded outranks the release gate", () => {
    const state = classify(
      { ...base, status: "paid", resultsReleased: false },
      now,
    );
    expect(state.kind).toBe("paid");
  });

  /**
   * A released or cancelled row is not pending anything. Withholding it would
   * leave the member staring at "entry received" for a spot that is gone.
   */
  test("a terminal status is lapsed even before release", () => {
    const state = classify(
      { ...base, status: "expired", spotNumber: null, resultsReleased: false },
      now,
    );
    expect(state.kind).toBe("lapsed");
  });
});

describe("lazy expiry", () => {
  test("a hold inside its window is due", () => {
    expect(classify(deadlineIn(HOUR), now).kind).toBe("due");
  });

  /**
   * The release cron is not the source of truth. A hold whose deadline has
   * passed reads as lapsed on sight, so a missed cron run can never show a
   * member a payment prompt for a spot that is on its way to the waitlist.
   */
  test("a hold well past its deadline is lapsed even though the row still says held", () => {
    expect(classify(deadlineIn(-2 * HOUR), now).kind).toBe("lapsed");
  });

  test("a hold with no deadline at all is lapsed", () => {
    expect(classify({ ...base, paymentDeadlineAt: null }, now).kind).toBe("lapsed");
  });

  test("terminal statuses are lapsed", () => {
    for (const status of ["expired", "cancelled", "refunded"]) {
      expect(classify({ ...base, status, spotNumber: null }, now).kind).toBe("lapsed");
    }
  });

  test("paid and waitlisted are reported as themselves", () => {
    expect(classify({ ...base, status: "paid" }, now).kind).toBe("paid");
    expect(
      classify({ ...base, status: "waitlisted", spotNumber: null }, now).kind,
    ).toBe("waitlisted");
  });
});

describe("the grace window", () => {
  /**
   * This screen and the reaper have to agree on when a hold dies. The reaper
   * waits out the same grace before releasing a spot, so a member who reaches
   * the page a minute late still sees somewhere to pay rather than being told
   * their spot is gone while it demonstrably still exists.
   */
  const grace = HOLD_GRACE_MINUTES * MINUTE;

  test("a deadline just passed is still due", () => {
    expect(classify(deadlineIn(-MINUTE), now).kind).toBe("due");
  });

  test("the last moment inside the grace is still due", () => {
    expect(classify(deadlineIn(-grace + MINUTE), now).kind).toBe("due");
  });

  test("the grace boundary itself is lapsed", () => {
    expect(classify(deadlineIn(-grace), now).kind).toBe("lapsed");
  });

  test("past the grace is lapsed", () => {
    expect(classify(deadlineIn(-grace - MINUTE), now).kind).toBe("lapsed");
  });
});

describe("loadPayState", () => {
  test("resolves a real pay token to a due signup", async () => {
    await deleteTestTrips();
    const tripId = await createTestTrip({ capacity: 3, priceCents: 8500 });
    const [memberId] = await getMemberIds(1);

    const result = await claimSpot(setupPool, tripId, memberId);
    expect(result.outcome).toBe("held");

    const state = await loadPayState(result.signup!.payToken);
    expect(state.kind).toBe("due");
    if (state.kind !== "due") return;

    expect(state.signup.amountCents).toBe(8500);
    expect(state.signup.spotNumber).toBe(1);
    expect(state.signup.tripId).toBe(tripId);
    expect(state.signup.resultsReleased).toBe(true);
  });

  test("a signup on an unreleased trip is pending", async () => {
    const tripId = await createTestTrip({ capacity: 3, resultsReleased: false });
    const [memberId] = await getMemberIds(1);

    const result = await claimSpot(setupPool, tripId, memberId);
    expect(result.outcome).toBe("held");

    expect((await loadPayState(result.signup!.payToken)).kind).toBe("pending");
  });

  test("an unknown token is not found", async () => {
    expect((await loadPayState("no-such-token")).kind).toBe("not_found");
  });
});
