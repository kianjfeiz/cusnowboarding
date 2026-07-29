/**
 * How long past its deadline a hold is left alone before the spot is reclaimed.
 *
 * The grace exists so the reaper can never beat an in-flight payment. It must
 * be the SAME number everywhere, because two different answers produce a window
 * where the roster reports a free spot that promotion then refuses to fill -
 * the board clicks Promote, gets "No spot is free", and stops trusting the tool.
 *
 * Consumers:
 *   - releaseLapsedHolds()            decides what to reap
 *   - getOccupancy()                  public "spots taken"
 *   - the admin trip counts           roster header and Promote button state
 *
 * Anything computing occupancy must treat a hold inside the grace as still
 * occupying its spot, because it does.
 */
export const HOLD_GRACE_MINUTES = 10;

/** Postgres interval literal, for embedding in SQL. */
export const HOLD_GRACE_INTERVAL = `interval '${HOLD_GRACE_MINUTES} minutes'`;

/** True while the hold still occupies its spot. */
export const HOLD_OCCUPIES_SQL = `(status = 'held' and payment_deadline_at > now() - ${HOLD_GRACE_INTERVAL})`;

/** True once the spot is genuinely reclaimable. */
export const HOLD_RECLAIMABLE_SQL = `(status = 'held' and payment_deadline_at <= now() - ${HOLD_GRACE_INTERVAL})`;
