import { unstable_cache } from "next/cache";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { execute } from "@/lib/db";
import { type TripStatus } from "@/lib/db/schema";

/**
 * Club events and the merged calendar. Events and trips are joined here at the
 * read layer rather than in the schema, which keeps the claim path and the
 * roster queries free of any notion of a party.
 */

// Re-exported so server callers have one import. Client components must import
// from event-kinds directly - see that file for why.
export {
  EVENT_KINDS,
  EVENT_KIND_LABELS,
  EVENT_STATUS_LABELS,
  type ClubEventKind,
  type ClubEventStatus,
} from "@/lib/events/event-kinds";

import { type ClubEventKind, type ClubEventStatus } from "@/lib/events/event-kinds";

const DENVER = "America/Denver";

export const EVENT_STATUS_HINTS: Record<ClubEventStatus, string> = {
  draft: "Not on the member calendar",
  published: "On the member calendar",
  cancelled: "Called off, hidden from members",
};

/**
 * An event is only ever draft or published. One that is not happening gets
 * deleted, because it carries no signups and no money to reconcile. `cancelled`
 * stays in the enum for old rows and has no moves on purpose.
 */
const EVENT_TRANSITIONS: Record<ClubEventStatus, ClubEventStatus[]> = {
  draft: ["published"],
  published: ["draft"],
  cancelled: [],
};

export function nextEventStatuses(status: ClubEventStatus): ClubEventStatus[] {
  return EVENT_TRANSITIONS[status] ?? [];
}

export function canTransitionEvent(from: ClubEventStatus, to: ClubEventStatus): boolean {
  return nextEventStatuses(from).includes(to);
}

export function eventTransitionLabel(_from: ClubEventStatus, to: ClubEventStatus): string {
  return to === "published" ? "Publish" : "Unpublish";
}

export function eventAuditAction(_from: ClubEventStatus, to: ClubEventStatus): string {
  return to === "published" ? "event.publish" : "event.unpublish";
}

// Completed trips stay listed: browsing back a month should show the season.
const CALENDAR_TRIP_STATUSES = "('scheduled','open','closed','completed')";

interface CalendarEventItem {
  kind: "event";
  id: string;
  slug: string;
  title: string;
  eventKind: ClubEventKind;
  description: string | null;
  locationName: string | null;
  address: string | null;
  mapUrl: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
}

interface CalendarTripItem {
  kind: "trip";
  id: string;
  slug: string;
  title: string;
  description: string | null;
  resort: string | null;
  tripStatus: TripStatus;
  startsAt: Date;
  endsAt: Date | null;
}

export type CalendarItem = CalendarEventItem | CalendarTripItem;

export interface CalendarRange {
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  to: Date;
}

/**
 * Everything overlapping the range, oldest first.
 *
 * The overlap test is deliberately not `starts_at between from and to`: a trip
 * that leaves on the 31st and returns on the 2nd has to appear in both months,
 * or the February view loses a weekend that people are actually on.
 */
export async function listCalendarItems(range: CalendarRange): Promise<CalendarItem[]> {
  const params = [range.from, range.to];

  // The columns are aliased to the item shape, so the rows are the items.
  const [eventItems, tripItems] = await Promise.all([
    execute<CalendarEventItem>(
      `select 'event' as kind, id, slug, title, kind::text as "eventKind", description,
              location_name as "locationName", address, map_url as "mapUrl",
              starts_at as "startsAt", ends_at as "endsAt", all_day as "allDay"
         from events
        where status = 'published'
          and starts_at < $2
          and (starts_at >= $1 or coalesce(ends_at, starts_at) > $1)
        order by starts_at`,
      params,
    ),
    execute<CalendarTripItem>(
      `select 'trip' as kind, id, slug, title, description, resort,
              status::text as "tripStatus", depart_at as "startsAt", return_at as "endsAt"
         from trips
        where status in ${CALENDAR_TRIP_STATUSES}
          and archived_at is null
          and depart_at < $2
          and (depart_at >= $1 or coalesce(return_at, depart_at) > $1)
        order by depart_at`,
      params,
    ),
  ]);

  // Title breaks the tie so two things at 7pm do not swap places between loads.
  return [...eventItems, ...tripItems].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.title.localeCompare(b.title),
  );
}

const listCalendarItemsCached = unstable_cache(
  async (fromIso: string, toIso: string) =>
    listCalendarItems({ from: new Date(fromIso), to: new Date(toIso) }),
  ["calendar-items"],
  { tags: ["trips", "events"], revalidate: 300 },
);

/**
 * `listCalendarItems`, cached across requests and users. Only useful for ranges
 * whose boundaries repeat between requests (the month grid): a now-anchored
 * range changes key every call, so the upcoming list uses the uncached read.
 *
 * The map revives what the JSON round trip flattened: on a cache hit
 * `startsAt`/`endsAt` arrive as ISO strings wearing `Date` types.
 */
export async function listCalendarItemsShared(range: CalendarRange): Promise<CalendarItem[]> {
  const items = await listCalendarItemsCached(
    range.from.toISOString(),
    range.to.toISOString(),
  );
  return items.map((item) => ({
    ...item,
    startsAt: new Date(item.startsAt),
    endsAt: item.endsAt ? new Date(item.endsAt) : null,
  }));
}

/**
 * Anything still in progress counts as upcoming, so a trip you are on does not
 * vanish from the list on its middle day.
 */
export async function listUpcomingCalendarItems(
  options: { weeks?: number; now?: Date } = {},
): Promise<CalendarItem[]> {
  const { weeks = 6, now = new Date() } = options;
  const to = new Date(now.getTime() + weeks * 7 * 24 * 3_600_000);
  return listCalendarItems({ from: now, to });
}

export interface MonthRef {
  year: number;
  /** 1-12, because that is what the URL carries. */
  month: number;
}

export interface GridDay {
  /** YYYY-MM-DD in Denver. */
  key: string;
  dayOfMonth: number;
  inMonth: boolean;
}

/**
 * Which day a thing lands on is a Denver question, not a UTC one: a party at
 * 11pm on the 3rd is in the 3rd's cell even though UTC has already rolled over.
 */
export function denverDayKey(at: Date): string {
  return formatInTimeZone(at, DENVER, "yyyy-MM-dd");
}

export function denverDayStart(key: string): Date {
  return fromZonedTime(`${key}T00:00:00`, DENVER);
}

function nextDayKey(key: string): string {
  const day = new Date(`${key}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/**
 * Every day cell an item belongs in. A multi-day trip is listed on each of its
 * days rather than only on the departure day, because that is what people are
 * checking the grid for.
 */
export function dayKeysFor(item: { startsAt: Date; endsAt: Date | null }): string[] {
  const first = denverDayKey(item.startsAt);
  const last = denverDayKey(item.endsAt ?? item.startsAt);

  const keys = [first];
  // Bounded so one bad row cannot make a page render thousands of cells.
  for (let cursor = first; cursor !== last && keys.length < 60; ) {
    cursor = nextDayKey(cursor);
    keys.push(cursor);
  }
  return keys;
}

export function currentMonth(now: Date = new Date()): MonthRef {
  const [year, month] = denverDayKey(now).split("-");
  return { year: Number(year), month: Number(month) };
}

/** `?m=2026-01`. Anything unparseable falls back to this month rather than 404s. */
export function parseMonthParam(value: string | undefined, now: Date = new Date()): MonthRef {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!match) return currentMonth(now);

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return currentMonth(now);
  return { year, month };
}

export function monthParam({ year, month }: MonthRef): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function shiftMonth({ year, month }: MonthRef, delta: number): MonthRef {
  const zeroBased = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

export function monthLabel({ year, month }: MonthRef): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

/**
 * The Sunday-aligned weeks a month renders as. Built from UTC date arithmetic
 * on purpose: this is pure calendar structure, and the only place a zone
 * matters is turning a day key back into an instant.
 */
export function monthWeeks({ year, month }: MonthRef): GridDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const cursor = new Date(first);
  cursor.setUTCDate(1 - first.getUTCDay());

  const weeks: GridDay[][] = [];
  do {
    const week: GridDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        key: cursor.toISOString().slice(0, 10),
        dayOfMonth: cursor.getUTCDate(),
        inMonth: cursor.getUTCMonth() === month - 1,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getUTCMonth() === month - 1 && cursor.getUTCFullYear() === year);

  return weeks;
}

/** The instants covered by a rendered grid, including its leading and trailing days. */
export function gridRange(weeks: GridDay[][]): CalendarRange {
  const days = weeks.flat();
  return {
    from: denverDayStart(days[0].key),
    to: denverDayStart(nextDayKey(days[days.length - 1].key)),
  };
}

export function monthRange(month: MonthRef): CalendarRange {
  const start = `${monthParam(month)}-01`;
  const next = shiftMonth(month, 1);
  return { from: denverDayStart(start), to: denverDayStart(`${monthParam(next)}-01`) };
}

interface EventRow {
  id: string;
  slug: string;
  title: string;
  kind: ClubEventKind;
  description: string | null;
  location_name: string | null;
  address: string | null;
  map_url: string | null;
  starts_at: Date;
  ends_at: Date | null;
  all_day: boolean;
  status: ClubEventStatus;
}

const EVENT_COLUMNS = `
  id, slug, title, kind::text as kind, description, location_name, address,
  map_url, starts_at, ends_at, all_day, status::text as status
`;

export async function listEvents(): Promise<EventRow[]> {
  return execute<EventRow>(`select ${EVENT_COLUMNS} from events order by starts_at desc`);
}

export async function getEvent(id: string): Promise<EventRow | null> {
  const rows = await execute<EventRow>(`select ${EVENT_COLUMNS} from events where id = $1`, [id]);
  return rows[0] ?? null;
}

export interface EventInput {
  title: string;
  kind: ClubEventKind;
  description: string | null;
  locationName: string | null;
  address: string | null;
  mapUrl: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
}

/**
 * The database has a CHECK for this. It is repeated here so the board gets a
 * sentence back in the form instead of a 500 from a constraint violation.
 */
export function validateEventWindow(startsAt: Date, endsAt: Date | null): string | null {
  if (endsAt && endsAt.getTime() < startsAt.getTime()) {
    return "The end time is before the start time.";
  }
  return null;
}

const WRITE_VALUES = (input: EventInput) => [
  input.title,
  input.kind,
  input.description,
  input.locationName,
  input.address,
  input.mapUrl,
  input.startsAt,
  input.endsAt,
  input.allDay,
];

export async function insertEvent(
  slug: string,
  input: EventInput,
  createdBy: string | null,
): Promise<string> {
  const rows = await execute<{ id: string }>(
    `insert into events (
       slug, title, kind, description, location_name, address, map_url,
       starts_at, ends_at, all_day, status, created_by
     ) values ($1,$2,$3::event_kind,$4,$5,$6,$7,$8,$9,$10,'draft',$11)
     returning id`,
    [slug, ...WRITE_VALUES(input), createdBy],
  );
  return rows[0].id;
}

export async function updateEventRecord(id: string, input: EventInput): Promise<boolean> {
  const rows = await execute<{ id: string }>(
    `update events
        set title = $2, kind = $3::event_kind, description = $4,
            location_name = $5, address = $6, map_url = $7, starts_at = $8,
            ends_at = $9, all_day = $10, updated_at = now()
      where id = $1
      returning id`,
    [id, ...WRITE_VALUES(input)],
  );
  return rows.length > 0;
}

export async function updateEventStatus(id: string, status: ClubEventStatus): Promise<boolean> {
  const rows = await execute<{ id: string }>(
    `update events set status = $2::event_status, updated_at = now()
      where id = $1
      returning id`,
    [id, status],
  );
  return rows.length > 0;
}

/**
 * Safe to hard-delete: an event has no signups or payments, and its photo rows
 * cascade. The audit row written by the caller is the only trace kept.
 */
export async function deleteEvent(id: string): Promise<boolean> {
  const rows = await execute<{ id: string }>(
    `delete from events where id = $1 returning id`,
    [id],
  );
  return rows.length > 0;
}
