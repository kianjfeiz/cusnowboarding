import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { MonthGrid } from "@/components/calendar/month-grid";
import { UpcomingList } from "@/components/calendar/upcoming-list";
import { UPCOMING_WEEKS, bucketViewsByDay, toCalendarItemViews } from "@/components/calendar/view";
import { DrawnTitle } from "@/components/drawn-title";
import { SectionHeading } from "@/components/ui";
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
} from "@/lib/events/events";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calendar - CU Snowboarding" };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const [{ m }, session] = await Promise.all([searchParams, auth()]);

  const month = parseMonthParam(m);
  const weeks = monthWeeks(month);

  // Two reads: browsing back to October must not drop what is coming up. The
  // shared cache only pays off for a repeating range, which a month grid is.
  const [gridItems, upcomingItems] = await Promise.all([
    listCalendarItemsShared(gridRange(weeks)),
    listUpcomingCalendarItems({ weeks: UPCOMING_WEEKS }),
  ]);

  const itemsByDay = bucketViewsByDay(toCalendarItemViews(gridItems));
  const upcoming = toCalendarItemViews(upcomingItems);

  const monthLinks = [
    { label: "Previous", href: `/calendar?m=${monthParam(shiftMonth(month, -1))}` },
    ...(monthParam(month) !== monthParam(currentMonth())
      ? [{ label: "Today", href: "/calendar" }]
      : []),
    { label: "Next", href: `/calendar?m=${monthParam(shiftMonth(month, 1))}` },
  ];

  return (
    <main className="mx-auto max-w-7xl px-5 py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <DrawnTitle name="calendar">Calendar</DrawnTitle>
          <p className="mt-1.5 text-sm text-ink-muted">All times Mountain.</p>
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

      <div className="grid gap-8 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section>
          <div className="mb-3 flex h-10 items-center sm:h-8">
            <SectionHeading>Upcoming</SectionHeading>
          </div>
          <UpcomingList items={upcoming} />
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink">{monthLabel(month)}</h2>
            <nav className="flex items-center gap-1 text-sm">
              {monthLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="inline-flex h-10 items-center rounded-md border border-border px-3 text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:h-8 sm:px-2.5"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          <MonthGrid weeks={weeks} itemsByDay={itemsByDay} todayKey={denverDayKey(new Date())} />
        </section>
      </div>
    </main>
  );
}
