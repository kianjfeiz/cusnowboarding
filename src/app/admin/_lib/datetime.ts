import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DENVER = "America/Denver";

/**
 * The board thinks in Mountain Time and nothing else - a drop is "8pm Tuesday",
 * not an offset. `datetime-local` inputs carry no zone, so both directions of
 * the conversion are pinned to Denver rather than to the browser or the server,
 * either of which may be somewhere else entirely.
 */
export function toDenverInput(date: Date | null | undefined): string {
  if (!date) return "";
  return formatInTimeZone(date, DENVER, "yyyy-MM-dd'T'HH:mm");
}

export function parseDenverInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = fromZonedTime(value, DENVER);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
