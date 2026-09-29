import type { TripStatus } from "@/lib/db/schema";

/**
 * Which moves the board can still make. Only scheduled, closed and cancelled
 * are destinations: the claim statement accepts a scheduled trip once
 * `signup_opens_at` has passed, so publishing IS scheduling and the clock does
 * the rest. `draft`, `open` and `completed` stay listed as sources so rows
 * written with them still have a way out.
 */
const TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["closed", "cancelled"],
  open: ["closed", "cancelled"],
  closed: ["scheduled", "cancelled"],
  cancelled: ["scheduled"],
  completed: [],
};

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** The same destination reads differently depending on where the trip is. */
export function transitionLabel(from: TripStatus, to: TripStatus): string {
  if (to === "cancelled") return "Cancel trip";
  if (to === "closed") return "Close signups";
  if (from === "closed") return "Reopen signups";
  if (from === "cancelled") return "Restore trip";
  return "Publish";
}

/**
 * What is actually happening to a trip, which is not what the status column
 * says: a scheduled trip is claimable or not depending only on the clock, so
 * this is derived from the same two timestamps the claim statement reads.
 */
export type TripPhase =
  | "draft"
  | "upcoming"
  | "live"
  | "over"
  | "sent"
  | "closed"
  | "cancelled"
  | "completed";

export function tripPhase(
  trip: {
    status: TripStatus;
    signup_opens_at: Date | string;
    signup_closes_at: Date | string | null;
    results_released_at: Date | string | null;
  },
  now: number = Date.now(),
): TripPhase {
  if (trip.status === "cancelled") return "cancelled";
  if (trip.status === "completed") return "completed";
  // Ahead of the status check: sending results sets the status to closed, and
  // without this every published trip would report "Closed early".
  if (trip.results_released_at) return "sent";
  if (trip.status === "closed") return "closed";
  if (trip.status === "draft") return "draft";

  if (new Date(trip.signup_opens_at).getTime() > now) return "upcoming";

  const closes = trip.signup_closes_at ? new Date(trip.signup_closes_at).getTime() : null;
  if (closes !== null && closes <= now) return "over";
  return "live";
}

/**
 * The stage names the whole board tool uses - the trips list, the dashboard and
 * the banner on the roster page - so a trip reads the same everywhere. Closing
 * early and running out the window end in the same place for the board: signups
 * are shut and the roster is waiting to be released.
 */
export const PHASE_LABELS: Record<TripPhase, string> = {
  draft: "Draft",
  upcoming: "Signups not open",
  live: "Signups open",
  over: "Signups closed",
  sent: "Roster released",
  closed: "Signups closed",
  cancelled: "Cancelled",
  completed: "Completed",
};

