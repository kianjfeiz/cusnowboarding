/**
 * Shared pieces of the two date controls.
 *
 * The value format is `YYYY-MM-DDTHH:mm` - exactly what `datetime-local` would
 * have submitted - so the server actions parsing these fields need no knowledge
 * that a custom control produced them. All values are Mountain Time, which is
 * what the surrounding form says and what parseDenverInput expects.
 */

export const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface Parts {
  year: number;
  month: number; // 0-indexed
  day: number;
  hour: number;
  minute: number;
}

export const pad = (n: number) => String(n).padStart(2, "0");

export function parseValue(value: string): Parts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]) - 1,
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
}

export function toValue(p: Parts): string {
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatTime(p: Parts): string {
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${pad(p.minute)} ${p.hour < 12 ? "AM" : "PM"}`;
}

export function formatDisplay(p: Parts | null): string {
  if (!p) return "";
  return `${MONTHS[p.month].slice(0, 3)} ${p.day}, ${p.year} at ${formatTime(p)}`;
}

/** Short form for the range control, where the time sits on its own line. */
export function formatDay(p: Parts | null): string {
  if (!p) return "";
  return `${MONTHS[p.month].slice(0, 3)} ${p.day}, ${p.year}`;
}

/**
 * Sortable integer for a calendar day: 2026-10-01 becomes 20261001. Comparing
 * these avoids constructing Dates purely to ask "is this day before that one",
 * which is where time zones creep into a control that is deliberately naive.
 */
export function dayKey(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

/** Days shown in the grid, including the leading blanks for alignment. */
export function monthGrid(year: number, month: number): Array<number | null> {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: count }, (_, i) => i + 1),
  ];
}

/** Month `delta` months from the given one, without mutating anything. */
export function shiftedMonth(year: number, month: number, delta: number) {
  const next = new Date(Date.UTC(year, month + delta, 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
}
