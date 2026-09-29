import { DAY_ONLY, formatDenver } from "@/components/ui";
import { EVENT_KIND_LABELS, dayKeysFor, denverDayKey, type CalendarItem } from "@/lib/events/events";

/** How far ahead "upcoming" looks, on the home page and the calendar alike. */
export const UPCOMING_WEEKS = 6;

/**
 * Every string the calendar renders is built here, on the server, so the
 * browser's own locale and zone never get a say in a Mountain Time event.
 */
export interface CalendarItemView {
  key: string;
  kind: "event" | "trip";
  title: string;
  /** "Party", "Meeting", "Trip" - a word, never a colour. */
  kindLabel: string;
  /** The same date split for the row list's calendar tile: "Jan" over "30". */
  monthShort: string;
  dayNum: string;
  /** "7:00 PM" or "All day" */
  timeLabel: string;
  /** The whole thing, spelled out for the dialog. */
  whenLabel: string;
  description: string | null;
  locationName: string | null;
  address: string | null;
  mapUrl: string | null;
  /** Trips link through to their own page; events live only on the calendar. */
  href: string | null;
  dayKeys: string[];
}

const DATE_ONLY: Intl.DateTimeFormatOptions = {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  ...DAY_ONLY,
};

const TIME_WITH_ZONE: Intl.DateTimeFormatOptions = { month: undefined, day: undefined };
const TIME_ONLY: Intl.DateTimeFormatOptions = { ...TIME_WITH_ZONE, timeZoneName: undefined };

/**
 * The board pastes map links by hand, and a `javascript:` URL in an href is the
 * one way a form field here could turn into script. Anything that is not plain
 * http(s) is dropped rather than rendered as a dead link.
 */
function safeMapUrl(url: string | null): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

function whenLabel(item: CalendarItem, allDay: boolean): string {
  const { startsAt, endsAt } = item;
  const sameDay = endsAt === null || denverDayKey(startsAt) === denverDayKey(endsAt);

  if (allDay) {
    if (!endsAt || sameDay) return `${formatDenver(startsAt, DATE_ONLY)}, all day`;
    return `${formatDenver(startsAt, DATE_ONLY)} to ${formatDenver(endsAt, DATE_ONLY)}, all day`;
  }

  if (!endsAt) return `${formatDenver(startsAt, DATE_ONLY)}, ${formatDenver(startsAt, TIME_WITH_ZONE)}`;

  if (sameDay) {
    return (
      `${formatDenver(startsAt, DATE_ONLY)}, ${formatDenver(startsAt, TIME_ONLY)}` +
      ` to ${formatDenver(endsAt, TIME_WITH_ZONE)}`
    );
  }

  return (
    `${formatDenver(startsAt, DATE_ONLY)}, ${formatDenver(startsAt, TIME_ONLY)}` +
    ` to ${formatDenver(endsAt, DATE_ONLY)}, ${formatDenver(endsAt, TIME_WITH_ZONE)}`
  );
}

function toCalendarItemView(item: CalendarItem): CalendarItemView {
  const allDay = item.kind === "event" && item.allDay;

  return {
    key: `${item.kind}:${item.id}`,
    kind: item.kind,
    title: item.title,
    kindLabel: item.kind === "trip" ? "Trip" : EVENT_KIND_LABELS[item.eventKind],
    monthShort: formatDenver(item.startsAt, { day: undefined, ...DAY_ONLY }),
    dayNum: formatDenver(item.startsAt, { month: undefined, ...DAY_ONLY }),
    timeLabel: allDay ? "All day" : formatDenver(item.startsAt, TIME_ONLY),
    whenLabel: whenLabel(item, allDay),
    description: item.description,
    locationName: item.kind === "trip" ? item.resort : item.locationName,
    address: item.kind === "trip" ? null : item.address,
    mapUrl: item.kind === "trip" ? null : safeMapUrl(item.mapUrl),
    href: item.kind === "trip" ? `/trips/${item.slug}` : null,
    dayKeys: dayKeysFor(item),
  };
}

export function toCalendarItemViews(items: CalendarItem[]): CalendarItemView[] {
  return items.map(toCalendarItemView);
}

export function bucketViewsByDay(views: CalendarItemView[]): Map<string, CalendarItemView[]> {
  const byDay = new Map<string, CalendarItemView[]>();
  for (const view of views) {
    for (const key of view.dayKeys) {
      const bucket = byDay.get(key);
      if (bucket) bucket.push(view);
      else byDay.set(key, [view]);
    }
  }
  return byDay;
}
