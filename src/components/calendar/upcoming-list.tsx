import type { CSSProperties } from "react";
import { CalendarEntry } from "./item-dialog";
import type { CalendarItemView } from "./view";

/** Past this point the tail arrives together; a 40-row list must not trickle. */
const STAGGER_LIMIT = 8;

export function UpcomingList({ items }: { items: CalendarItemView[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-paper px-4 py-8 text-center text-sm text-ink-muted">
        Nothing on the calendar for the next few weeks.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li
          key={item.key}
          className="rise"
          style={
            {
              "--rise-delay": `${Math.min(index, STAGGER_LIMIT) * 45}ms`,
            } as CSSProperties
          }
        >
          <CalendarEntry item={item} variant="row" />
        </li>
      ))}
    </ul>
  );
}
