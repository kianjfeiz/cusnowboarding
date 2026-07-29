import { execute } from "@/lib/db";

/**
 * Board capabilities.
 *
 * Roles are rows in `board_user_roles` scoped to a term year, never an enum on
 * the user, so this file is the single place that turns "who holds what role
 * this year" into "what may they do". Every server action calls into here
 * before it writes; hiding a button is a courtesy, not a control.
 */

export const ROLE_KEYS = [
  "president",
  "vp",
  "treasurer",
  "travel",
  "merch",
  "events",
  "media",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const CAPABILITIES = [
  "viewRosters",
  "manageTrips",
  "manageEvents",
  "managePromotions",
  "managePayments",
  "manageBoard",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface Actor {
  boardUserId: string;
  email: string;
  name: string | null;
  /** Roles held for the current term year or a future one. */
  roles: RoleKey[];
  isSuperadmin: boolean;
}

/** "any" means every active board user; "superadmin" means the flag, not a role. */
const GRANTS: Record<Capability, "any" | "superadmin" | readonly RoleKey[]> = {
  viewRosters: "any",
  manageTrips: ["president", "vp", "travel"],
  /**
   * Separate from manageTrips so the events coordinator can run the parties and
   * socials they are responsible for. Folding them together meant the travel
   * coordinator could edit events while the events coordinator could not.
   */
  manageEvents: ["events", "president", "vp"],
  managePromotions: ["travel", "president", "vp"],
  managePayments: ["treasurer", "president"],
  manageBoard: "superadmin",
};

export const CAPABILITY_LABELS: Record<Capability, string> = {
  viewRosters: "View rosters and exports",
  manageTrips: "Create, edit, and publish trips",
  manageEvents: "Create, edit, and publish events",
  managePromotions: "Promote from the waitlist and release holds",
  managePayments: "Mark paid offline and issue refunds",
  manageBoard: "Manage board users and roles",
};

export function can(actor: Actor | null, capability: Capability): boolean {
  if (!actor) return false;

  const grant = GRANTS[capability];
  if (grant === "superadmin") return actor.isSuperadmin;

  // The superadmin is the president, who can assign themselves any role in
  // seconds. Withholding an operational capability would be theatre, and it
  // would leave the club locked out if a coordinator graduated mid-season.
  if (actor.isSuperadmin) return true;

  if (grant === "any") return true;
  return actor.roles.some((role) => grant.includes(role));
}

export class ForbiddenError extends Error {
  readonly capability: Capability;

  constructor(capability: Capability) {
    super(`Not permitted: ${CAPABILITY_LABELS[capability]}`);
    this.name = "ForbiddenError";
    this.capability = capability;
  }
}

/** Server-side gate. Throws rather than returning false so it cannot be ignored. */
export function assertCapability(
  actor: Actor | null,
  capability: Capability,
): asserts actor is Actor {
  if (!can(actor, capability)) throw new ForbiddenError(capability);
}

/**
 * Term year 2026 means the 2026-27 academic year, which begins in August. A
 * role from two boards ago must stop granting anything on its own.
 */
export function currentTermYear(now: Date = new Date()): number {
  const denver = new Date(now.toLocaleString("en-US", { timeZone: "America/Denver" }));
  return denver.getMonth() >= 7 ? denver.getFullYear() : denver.getFullYear() - 1;
}

/**
 * Resolves a board identity from an email address.
 *
 * There is no self-signup: an address that is absent or inactive resolves to
 * null and is refused at sign-in. This is also re-run on every admin request
 * rather than trusted from the JWT, so removing someone from the board takes
 * effect on their next page load instead of at token expiry.
 */
export async function loadBoardIdentity(email: string): Promise<Actor | null> {
  const rows = await execute<{
    id: string;
    email: string;
    name: string | null;
    is_superadmin: boolean;
    roles: string[];
  }>(
    `select b.id, b.email::text as email, b.name, b.is_superadmin,
            coalesce(array_remove(array_agg(ur.role_key), null), '{}') as roles
       from board_users b
       left join board_user_roles ur
         on ur.board_user_id = b.id and ur.term_year >= $2
      where b.email = $1 and b.is_active
      group by b.id, b.email, b.name, b.is_superadmin`,
    [email, currentTermYear()],
  );

  const row = rows[0];
  if (!row) return null;

  const known = new Set<string>(ROLE_KEYS);
  return {
    boardUserId: row.id,
    email: row.email,
    name: row.name,
    roles: row.roles.filter((key): key is RoleKey => known.has(key)),
    isSuperadmin: row.is_superadmin,
  };
}

/** Records the sign-in so the board can see who is still using the tool. */
export async function touchLastLogin(boardUserId: string): Promise<void> {
  await execute(`update board_users set last_login_at = now() where id = $1`, [boardUserId]);
}
