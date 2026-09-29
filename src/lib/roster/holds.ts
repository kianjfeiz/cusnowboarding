/**
 * How long past its deadline a hold is left alone before the spot is reclaimed,
 * so the reaper can never beat an in-flight payment. It must be the SAME number
 * everywhere occupancy is computed (releaseLapsedHolds, getOccupancy, the admin
 * trip counts): two answers produce a window where the roster reports a free
 * spot that promotion then refuses to fill.
 */
export const HOLD_GRACE_MINUTES = 10;

/** Postgres interval literal, for embedding in SQL. */
export const HOLD_GRACE_INTERVAL = `interval '${HOLD_GRACE_MINUTES} minutes'`;

/**
 * True while the hold still occupies its spot. Embed only in queries whose
 * FROM is the `signups` table under its own name.
 *
 * A hold on a trip whose results are unreleased always occupies: its deadline
 * is a placeholder that release will reset, and the reaper refuses to touch it
 * for the same reason.
 */
export const HOLD_OCCUPIES_SQL = `(status = 'held' and (
  payment_deadline_at > now() - ${HOLD_GRACE_INTERVAL}
  or exists (
    select 1 from trips t
     where t.id = signups.trip_id and t.results_released_at is null
  )
))`;
