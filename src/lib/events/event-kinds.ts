/**
 * Event kind and status vocabulary, deliberately free of any database import:
 * the admin event form is a client component, and importing these from
 * `events.ts` would drag the `pg` driver into the client bundle and fail the
 * build. Anything a client component needs from the events domain belongs here.
 */

export const EVENT_KINDS = ["party", "meeting", "social", "fundraiser", "other"] as const;
export type ClubEventKind = (typeof EVENT_KINDS)[number];

export type ClubEventStatus = "draft" | "published" | "cancelled";

/** Kind reads as a word. It is never carried by colour or an icon. */
export const EVENT_KIND_LABELS: Record<ClubEventKind, string> = {
  party: "Party",
  meeting: "Meeting",
  social: "Social",
  fundraiser: "Fundraiser",
  other: "Event",
};

export const EVENT_STATUS_LABELS: Record<ClubEventStatus, string> = {
  draft: "Draft",
  published: "Published",
  cancelled: "Cancelled",
};
