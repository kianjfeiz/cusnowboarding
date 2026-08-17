import { createHash, timingSafeEqual } from "node:crypto";
import type { Actor } from "@/lib/authz";

/**
 * Read-only demo access, so the site can be shown to someone who has no CU
 * Google account - a recruiter following a portfolio link.
 *
 * This is a SECOND path to a session, which is exactly what the comment in
 * src/auth.ts warns against, so the blast radius is pinned down here rather
 * than left to callers to remember:
 *
 *   - No `members` row is created or linked, so a demo session is nobody.
 *   - `/api/member/arm` refuses it, so it never holds `csc_member`. The drop
 *     path reads that cookie and nothing else, which is what keeps all of this
 *     off the one route that must not change.
 *   - `currentActor()` returns null for it, so the board portal stays closed
 *     even if this address somehow appeared in `board_users`.
 *
 * Without DEMO_PASSWORD the feature does not exist: no provider is registered
 * and no form is rendered. That absence is the off switch.
 */

export const DEMO_PROVIDER = "demo";

/**
 * `.invalid` is reserved by RFC 2606 and can never resolve, so this address
 * cannot collide with a real CU account and cannot receive mail. It is an
 * identifier, not a mailbox.
 */
export const DEMO_EMAIL = "demo@cusnowboarding.invalid";
export const DEMO_USER_ID = "demo";
export const DEMO_NAME = "Demo visitor";

export function demoEnabled(): boolean {
  return Boolean(process.env.DEMO_PASSWORD);
}

/**
 * Compared as SHA-256 digests rather than strings: `timingSafeEqual` throws on
 * a length mismatch, and how long the supplied password is should not be
 * something an attempt can measure.
 */
export function demoPasswordMatches(supplied: string): boolean {
  const expected = process.env.DEMO_PASSWORD;
  if (!expected) return false;

  return timingSafeEqual(
    createHash("sha256").update(supplied).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

/**
 * The read-only board identity handed to a demo visitor. Exported so the two
 * screens that must stay shut can recognise it - see `isDemoActor`.
 */
export const DEMO_ACTOR: Actor = {
  boardUserId: "demo",
  email: DEMO_EMAIL,
  name: DEMO_NAME,
  roles: [],
  isSuperadmin: false,
};

/**
 * True for the demo visitor.
 *
 * Capabilities cannot express "everything a board member may read EXCEPT the
 * people directory", because both are `viewRosters` - the members page and the
 * trip roster listing are the same permission. So the two surfaces carrying
 * names against emails and phone numbers check this directly.
 */
export function isDemoActor(actor: Actor | null): boolean {
  return actor?.email === DEMO_EMAIL;
}
