import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Cron endpoints mutate signups, so they must not be callable by
 * anyone who guesses the path. Vercel sends `Authorization: Bearer $CRON_SECRET`.
 *
 * In development, with no CRON_SECRET set, the endpoints are open so they can be
 * triggered by hand. In production a missing secret fails closed.
 */
export function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (!secret) return process.env.NODE_ENV !== "production";

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
