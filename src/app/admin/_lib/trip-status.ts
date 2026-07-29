import type { TripStatus } from "@/lib/db/schema";

/**
 * Allowed status moves, written out rather than inferred, so "can a closed trip
 * be reopened" has one answer instead of three buttons that disagree.
 */
const TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["open", "draft", "cancelled"],
  open: ["closed", "cancelled"],
  closed: ["open", "completed"],
  cancelled: ["draft"],
  completed: [],
};

/** Label for the button that moves a trip *into* this status. */
export const TRANSITION_LABELS: Record<TripStatus, string> = {
  draft: "Back to draft",
  scheduled: "Publish",
  open: "Open now",
  closed: "Close signups",
  cancelled: "Cancel trip",
  completed: "Mark completed",
};

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  open: "Open",
  closed: "Closed",
  cancelled: "Cancelled",
  completed: "Completed",
};

export const TRIP_STATUS_HINTS: Record<TripStatus, string> = {
  draft: "Not visible to members",
  scheduled: "Visible, signups not open yet",
  open: "Members can claim spots",
  closed: "No further claims",
  cancelled: "Called off",
  completed: "Done and settled",
};

export function nextStatuses(status: TripStatus): TripStatus[] {
  return TRANSITIONS[status] ?? [];
}

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return nextStatuses(from).includes(to);
}
