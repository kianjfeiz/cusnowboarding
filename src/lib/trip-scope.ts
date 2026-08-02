/**
 * The archived-trip predicate, in one place.
 *
 * Archiving is meant to remove a trip from the running of the club, not just
 * from the trip list - so the same condition has to appear on every query that
 * counts money, sends mail, or shows a member something. It was originally
 * added to the two listing queries only, and the trip promptly went on showing
 * up in payments, on the calendar, and in the cron batches.
 *
 * A shared constant does not stop someone forgetting it on a new query, but it
 * does make the omission visible in review, and it means the rule is written
 * down once rather than reinvented per file.
 *
 * The `t` alias is the convention throughout; use `notArchived("trips")` where
 * a query names the table instead.
 */
export const NOT_ARCHIVED = "t.archived_at is null";

export function notArchived(alias: string): string {
  return `${alias}.archived_at is null`;
}
