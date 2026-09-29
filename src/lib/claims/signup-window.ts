/**
 * How long signups stay open after the drop. Derived from the open time rather
 * than set by hand; the claim statement still enforces `signup_closes_at`, so a
 * trip cannot accept entries forever if the board forgets about it.
 */
export const SIGNUP_WINDOW_HOURS = 2;

export function signupClosesAt(opensAt: Date): Date {
  return new Date(opensAt.getTime() + SIGNUP_WINDOW_HOURS * 3_600_000);
}
