import { HOLD_GRACE_MINUTES } from "@/lib/roster/holds";

/** Where a signup stands, as the member is allowed to see it. */
export type Standing = "board" | "pending" | "paid" | "waitlisted" | "lapsed" | "due";

/**
 * Lazy expiry on read. The grace must match the reaper's (lib/roster/holds.ts),
 * or a page declares a hold dead while /pay still takes payment for it.
 */
function holdLapsed(deadline: Date | string | null, now = Date.now()): boolean {
  return (
    deadline === null ||
    new Date(deadline).getTime() <= now - HOLD_GRACE_MINUTES * 60_000
  );
}

/**
 * Same order as `classify` in lib/money/payments.ts. Until results are released
 * a drop entrant learns only that the entry landed - held and waitlisted must
 * be indistinguishable here, or reloading a page becomes the scoreboard.
 */
export function standingOf(signup: {
  status: string;
  spotNumber: number | null;
  paymentDeadlineAt: Date | string | null;
  resultsReleased: boolean;
}): Standing {
  const live = signup.status === "held" || signup.status === "waitlisted";

  // `signups_state_shape`: the only paid row without a spot is a board seat.
  if (signup.status === "paid") return signup.spotNumber === null ? "board" : "paid";
  if (live && !signup.resultsReleased) return "pending";
  if (signup.status === "waitlisted") return "waitlisted";
  if (signup.status !== "held" || holdLapsed(signup.paymentDeadlineAt)) return "lapsed";
  return "due";
}
