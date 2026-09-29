import { CalendarEntry } from "./item-dialog";
import type { CalendarItemView } from "./view";

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
      {items.map((item) => (
        <li key={item.key}>
          <CalendarEntry item={item} variant="row" />
        </li>
      ))}
    </ul>
  );
}
