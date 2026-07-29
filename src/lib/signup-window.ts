/**
 * How long signups stay open after the drop.
 *
 * The board never set a close time by hand - every drop is decided in the first
 * seconds, and the field was one more thing to get wrong on a form filled in
 * under time pressure. It is derived from the open time instead.
 *
 * The window still exists in the database (`trips.signup_closes_at`) and the
 * claim statement still enforces it, so a trip cannot accept entries forever if
 * the board forgets about it. Only the manual control is gone.
 */
export const SIGNUP_WINDOW_HOURS = 2;

export function signupClosesAt(opensAt: Date): Date {
  return new Date(opensAt.getTime() + SIGNUP_WINDOW_HOURS * 3_600_000);
}
