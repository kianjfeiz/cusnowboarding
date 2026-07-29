import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { execute } from "@/lib/db";
import { eventKind, eventStatus, type TripStatus } from "@/lib/db/schema";

/**
 * Club events and the merged calendar.
 *
 * Members do not think of "events" and "trips" as two things - a Tuesday
 * meeting and a Loveland trip are both just something on the calendar. So the
 * two tables are joined here at the read layer rather than in the schema, which
 * keeps the claim path and the roster queries free of any notion of a party.
 */

/**
 * The vocabulary lives in `lib/event-kinds.ts` and is re-exported here so
 * server callers have one import. Client components must import it from there
 * directly - see that file for why.
 */
export {
  DENVER,
  EVENT_KINDS,
  EVENT_KIND_LABELS,
  EVENT_STATUS_LABELS,
  type ClubEventKind,
  type ClubEventStatus,
} from "@/lib/event-kinds";

import { DENVER, type ClubEventKind, type ClubEventStatus } from "@/lib/event-kinds";

export const EVENT_STATUS_HINTS: Record<ClubEventStatus, string> = {
  draft: "Not on the member calendar",
  published: "On the member calendar",
  cancelled: "Called off, hidden from members",
};

/**
 * Allowed status moves, written out rather than inferred, the same way trip
 * statuses are. A cancelled event goes back to draft rather than straight to
 * published: un-cancelling something in front of the whole club should be a
 * deliberate second step.
 */
const EVENT_TRANSITIONS: Record<ClubEventStatus, ClubEventStatus[]> = {
  draft: ["published", "cancelled"],
  published: ["draft", "cancelled"],
  cancelled: ["draft"],
};

export function nextEventStatuses(status: ClubEventStatus): ClubEventStatus[] {
  return EVENT_TRANSITIONS[status] ?? [];
}

export function canTransitionEvent(from: ClubEventStatus, to: ClubEventStatus): boolean {
  return nextEventStatuses(from).includes(to);
}

/** The label reads as what the button does, which depends on where it starts. */
export function eventTransitionLabel(from: ClubEventStatus, to: ClubEventStatus): string {
  if (to === "published") return "Publish";
  if (to === "cancelled") return "Cancel";
  return from === "cancelled" ? "Restore to draft" : "Unpublish";
}

export function eventAuditAction(from: ClubEventStatus, to: ClubEventStatus): string {
  if (to === "published") return "event.publish";
  if (to === "cancelled") return "event.cancel";
  return from === "cancelled" ? "event.restore" : "event.unpublish";
}

/**
 * Trip statuses that belong on a calendar. Drafts are not public yet and a
 * cancelled trip is not happening, so neither is something to plan around.
 * Completed trips stay listed: browsing back a month should show the season.
 */
const CALENDAR_TRIP_STATUSES = "('scheduled','open','closed','completed')";

// ---------------------------------------------------------------------------
// The merged feed
// ---------------------------------------------------------------------------

export interface CalendarEventItem {
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
  isTwentyOnePlus: boolean;
}

export interface CalendarTripItem {
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

  const [eventRows, tripRows] = await Promise.all([
    execute<{
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
      is_twenty_one_plus: boolean;
    }>(
      `select id, slug, title, kind::text as kind, description, location_name,
              address, map_url, starts_at, ends_at, all_day, is_twenty_one_plus
         from events
        where status = 'published'
          and starts_at < $2
          and (starts_at >= $1 or coalesce(ends_at, starts_at) > $1)
        order by starts_at`,
      params,
    ),
    execute<{
      id: string;
      slug: string;
      title: string;
      description: string | null;
      resort: string | null;
      status: TripStatus;
      depart_at: Date;
      return_at: Date | null;
    }>(
      `select id, slug, title, description, resort, status::text as status,
              depart_at, return_at
         from trips
        where status in ${CALENDAR_TRIP_STATUSES}
          and depart_at < $2
          and (depart_at >= $1 or coalesce(return_at, depart_at) > $1)
        order by depart_at`,
      params,
    ),
  ]);

  const items: CalendarItem[] = [
    ...eventRows.map(
      (row): CalendarEventItem => ({
        kind: "event",
        id: row.id,
        slug: row.slug,
        title: row.title,
        eventKind: row.kind,
        description: row.description,
        locationName: row.location_name,
        address: row.address,
        mapUrl: row.map_url,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        allDay: row.all_day,
        isTwentyOnePlus: row.is_twenty_one_plus,
      }),
    ),
    ...tripRows.map(
      (row): CalendarTripItem => ({
        kind: "trip",
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        resort: row.resort,
        tripStatus: row.status,
        startsAt: row.depart_at,
        endsAt: row.return_at,
      }),
    ),
  ];

  return sortCalendarItems(items);
}

/** Title breaks the tie so two things at 7pm do not swap places between loads. */
export function sortCalendarItems(items: CalendarItem[]): CalendarItem[] {
  return items.sort((a, b) => {
    const delta = a.startsAt.getTime() - b.startsAt.getTime();
    if (delta !== 0) return delta;
    return a.title.localeCompare(b.title);
  });
}

/**
 * What is coming up, which on a phone is the only part anyone reads. Anything
 * still in progress counts as upcoming, so a trip you are on does not vanish
 * from the list on its middle day.
 */
export async function listUpcomingCalendarItems(
  options: { weeks?: number; now?: Date } = {},
): Promise<CalendarItem[]> {
  const { weeks = 6, now = new Date() } = options;
  const to = new Date(now.getTime() + weeks * 7 * 24 * 3_600_000);
  return listCalendarItems({ from: now, to });
}

// ---------------------------------------------------------------------------
// Denver calendar arithmetic
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Board read model
// ---------------------------------------------------------------------------

export interface EventRow {
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
  is_twenty_one_plus: boolean;
}

const EVENT_COLUMNS = `
  id, slug, title, kind::text as kind, description, location_name, address,
  map_url, starts_at, ends_at, all_day, status::text as status, is_twenty_one_plus
`;

export async function listEvents(): Promise<EventRow[]> {
  return execute<EventRow>(`select ${EVENT_COLUMNS} from events order by starts_at desc`);
}

export async function getEvent(id: string): Promise<EventRow | null> {
  const rows = await execute<EventRow>(`select ${EVENT_COLUMNS} from events where id = $1`, [id]);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface EventInput {
  slug: string;
  title: string;
  kind: ClubEventKind;
  description: string | null;
  locationName: string | null;
  address: string | null;
  mapUrl: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  isTwentyOnePlus: boolean;
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

export function slugifyEvent(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function isDuplicateSlug(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

const WRITE_VALUES = (input: EventInput) => [
  input.slug,
  input.title,
  input.kind,
  input.description,
  input.locationName,
  input.address,
  input.mapUrl,
  input.startsAt,
  input.endsAt,
  input.allDay,
  input.isTwentyOnePlus,
];

export async function insertEvent(
  input: EventInput,
  createdBy: string | null,
): Promise<string> {
  const rows = await execute<{ id: string }>(
    `insert into events (
       slug, title, kind, description, location_name, address, map_url,
       starts_at, ends_at, all_day, is_twenty_one_plus, status, created_by
     ) values ($1,$2,$3::event_kind,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12)
     returning id`,
    [...WRITE_VALUES(input), createdBy],
  );
  return rows[0].id;
}

export async function updateEventRecord(id: string, input: EventInput): Promise<boolean> {
  const rows = await execute<{ id: string }>(
    `update events
        set slug = $2, title = $3, kind = $4::event_kind, description = $5,
            location_name = $6, address = $7, map_url = $8, starts_at = $9,
            ends_at = $10, all_day = $11, is_twenty_one_plus = $12, updated_at = now()
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
