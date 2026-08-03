import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { MonthGrid } from "@/components/calendar/month-grid";
import { UpcomingList } from "@/components/calendar/upcoming-list";
import { bucketViewsByDay, toCalendarItemViews } from "@/components/calendar/view";
import { DrawnTitle } from "@/components/drawn-title";
import {
  currentMonth,
  denverDayKey,
  gridRange,
  listCalendarItemsShared,
  listUpcomingCalendarItems,
  monthLabel,
  monthParam,
  monthWeeks,
  parseMonthParam,
  shiftMonth,
} from "@/lib/events";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calendar - CU Snowboarding" };

const UPCOMING_WEEKS = 6;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const [{ m }, session] = await Promise.all([searchParams, auth()]);

  const month = parseMonthParam(m);
  const weeks = monthWeeks(month);

  // Two reads rather than one filtered in memory: the visible grid and the
  // next several weeks rarely cover the same range, and browsing back to
  // October should not quietly drop what is coming up.
  const [gridItems, upcomingItems] = await Promise.all([
    // The shared cache only pays off for repeating ranges, which a month grid
    // is and a now-anchored upcoming window is not.
    listCalendarItemsShared(gridRange(weeks)),
    listUpcomingCalendarItems({ weeks: UPCOMING_WEEKS }),
  ]);

  const itemsByDay = bucketViewsByDay(toCalendarItemViews(gridItems));
  const upcoming = toCalendarItemViews(upcomingItems);

  const previous = monthParam(shiftMonth(month, -1));
  const next = monthParam(shiftMonth(month, 1));
  const thisMonth = currentMonth();
  const showToday = monthParam(month) !== monthParam(thisMonth);

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <DrawnTitle name="calendar">Calendar</DrawnTitle>
          <p className="mt-1.5 text-sm text-ink-muted">
            Club events and trips, all in Mountain Time.
          </p>
        </div>
        {session?.user?.boardUserId ? (
          <Link
            href="/admin/events"
            className="-my-2 py-2 text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
          >
            Manage events
          </Link>
        ) : null}
      </header>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{monthLabel(month)}</h2>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href={`/calendar?m=${previous}`}
            className="inline-flex h-10 items-center rounded-md border border-border px-3 text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:h-8 sm:px-2.5"
          >
            Previous
          </Link>
          {showToday ? (
            <Link
              href="/calendar"
              className="inline-flex h-10 items-center rounded-md border border-border px-3 text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:h-8 sm:px-2.5"
            >
              Today
            </Link>
          ) : null}
          <Link
            href={`/calendar?m=${next}`}
            className="inline-flex h-10 items-center rounded-md border border-border px-3 text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:h-8 sm:px-2.5"
          >
            Next
          </Link>
        </nav>
      </div>

      <MonthGrid weeks={weeks} itemsByDay={itemsByDay} todayKey={denverDayKey(new Date())} />

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
          Upcoming
        </h2>
        <UpcomingList items={upcoming} />
      </section>
    </main>
  );
}
