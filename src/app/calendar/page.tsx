import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { SiteHeader } from "@/components/site-header";
import { MonthGrid } from "@/components/calendar/month-grid";
import { UpcomingList } from "@/components/calendar/upcoming-list";
import { bucketViewsByDay, toCalendarItemViews } from "@/components/calendar/view";
import {
  currentMonth,
  denverDayKey,
  gridRange,
  listCalendarItems,
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
    listCalendarItems(gridRange(weeks)),
    listUpcomingCalendarItems({ weeks: UPCOMING_WEEKS }),
  ]);

  const itemsByDay = bucketViewsByDay(toCalendarItemViews(gridItems));
  const upcoming = toCalendarItemViews(upcomingItems);

  const previous = monthParam(shiftMonth(month, -1));
  const next = monthParam(shiftMonth(month, 1));
  const thisMonth = currentMonth();
  const showToday = monthParam(month) !== monthParam(thisMonth);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-5 py-10">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              Club events and trips, all in Mountain Time.
            </p>
          </div>
          {session?.user?.boardUserId ? (
            <Link
              href="/admin/events"
              className="text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
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
              className="rounded-md border border-border px-2.5 py-1.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              Previous
            </Link>
            {showToday ? (
              <Link
                href="/calendar"
                className="rounded-md border border-border px-2.5 py-1.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
              >
                Today
              </Link>
            ) : null}
            <Link
              href={`/calendar?m=${next}`}
              className="rounded-md border border-border px-2.5 py-1.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
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
    </>
  );
}
