/**
 * Event kind and status vocabulary, deliberately kept free of any database
 * import.
 *
 * The admin event form is a client component and needs these labels. Importing
 * them from `lib/events.ts` dragged that module's `@/lib/db` import - and with
 * it the whole `pg` driver - into the client bundle, which fails the build
 * outright because `pg` requires `dns`, `net`, `tls` and `fs`.
 *
 * Anything a client component needs from the events domain belongs here.
 */

export const EVENT_KINDS = ["party", "meeting", "social", "fundraiser", "other"] as const;
export type ClubEventKind = (typeof EVENT_KINDS)[number];

export const EVENT_STATUSES = ["draft", "published", "cancelled"] as const;
export type ClubEventStatus = (typeof EVENT_STATUSES)[number];

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

export const DENVER = "America/Denver";
