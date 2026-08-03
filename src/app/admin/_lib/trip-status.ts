import type { TripStatus } from "@/lib/db/schema";

/**
 * Which moves the board can still make, written out rather than inferred.
 *
 * Three states are reachable now: scheduled, closed, cancelled.
 *
 * `open` is gone as a destination. The claim statement accepts a scheduled trip
 * once `signup_opens_at` has passed, so publishing IS scheduling and the clock
 * does the rest - a button that had to be pressed at 8pm was a single point of
 * silent failure. `draft` is gone because a scheduled trip in the future
 * already is one: nobody can claim before the drop, and a trip the board cannot
 * see on its own list is a trip nobody remembers to publish. `completed` is
 * gone because marking it hid the trip from the payments totals, which is the
 * opposite of what a trip with money still owed needs.
 *
 * All three stay listed as *sources* so that rows written before this still
 * have a way out.
 */
const TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["closed", "cancelled"],
  open: ["closed", "cancelled"],
  closed: ["scheduled", "cancelled"],
  cancelled: ["scheduled"],
  completed: [],
};

export function nextStatuses(status: TripStatus): TripStatus[] {
  return TRANSITIONS[status] ?? [];
}

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return nextStatuses(from).includes(to);
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
 * says. A scheduled trip is claimable or not depending only on the clock, so
 * the board reading this row at 7:58pm needs the answer derived from the same
 * two timestamps the claim statement reads.
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

export interface PhaseInput {
  status: TripStatus;
  signup_opens_at: Date | string;
  signup_closes_at: Date | string | null;
  results_released_at: Date | string | null;
}

export function tripPhase(trip: PhaseInput, now: number = Date.now()): TripPhase {
  if (trip.status === "cancelled") return "cancelled";
  if (trip.status === "completed") return "completed";
  /*
    Ahead of the status check, because sending results is what sets the status
    to closed. Without this every published trip would report "Closed early",
    which is the one thing it is not - and would offer to reopen signups on a
    roster everybody has already been shown.
  */
  if (trip.results_released_at) return "sent";
  if (trip.status === "closed") return "closed";
  if (trip.status === "draft") return "draft";

  if (new Date(trip.signup_opens_at).getTime() > now) return "upcoming";

  const closes = trip.signup_closes_at ? new Date(trip.signup_closes_at).getTime() : null;
  if (closes !== null && closes <= now) return "over";
  return "live";
}

export const PHASE_LABELS: Record<TripPhase, string> = {
  draft: "Draft",
  upcoming: "Scheduled",
  live: "Signups live",
  over: "Signups over",
  sent: "Signups closed",
  closed: "Closed early",
  cancelled: "Cancelled",
  completed: "Completed",
};

/*
  There was a PHASE_HINTS map here, one sentence per phase, rendered under the
  status badge. Every line restated its own badge - "Closed early" above
  "Closed by the board, no further claims" - so it read as noise on a screen
  the board scans rather than reads. The badge is the status; the phase labels
  above are the vocabulary.
*/
