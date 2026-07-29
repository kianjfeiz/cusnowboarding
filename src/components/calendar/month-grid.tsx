import { cn } from "@/components/ui";
import type { GridDay } from "@/lib/events";
import { CalendarEntry } from "./item-dialog";
import type { CalendarItemView } from "./view";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Seven columns do not fit a phone at a readable size, so the grid scrolls
 * inside its own container rather than pushing the page sideways. The Upcoming
 * list underneath is the view that actually works on a small screen; this one
 * is here for the shape of the month.
 */
export function MonthGrid({
  weeks,
  itemsByDay,
  todayKey,
}: {
  weeks: GridDay[][];
  itemsByDay: Map<string, CalendarItemView[]>;
  todayKey: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-paper">
      <div className="min-w-[46rem]">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-ink-faint"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {weeks.flat().map((day) => {
            const items = itemsByDay.get(day.key) ?? [];
            return (
              <div
                key={day.key}
                className={cn(
                  "min-h-28 border-b border-r border-border p-1.5",
                  // The container already draws the outer edges.
                  "[&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0",
                  day.inMonth ? "bg-paper" : "bg-surface",
                )}
              >
                <div
                  className={cn(
                    "tnum mb-1 px-1 text-xs",
                    day.key === todayKey
                      ? "font-semibold text-accent"
                      : day.inMonth
                        ? "text-ink-muted"
                        : "text-ink-faint",
                  )}
                >
                  {day.dayOfMonth}
                </div>

                <div className="space-y-1">
                  {items.map((item) => (
                    <CalendarEntry key={item.key} item={item} variant="cell" />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
