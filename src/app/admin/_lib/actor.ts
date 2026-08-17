import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DEMO_ACTOR, DEMO_EMAIL } from "@/lib/demo";
import {
  assertCapability,
  loadBoardIdentity,
  type Actor,
  type Capability,
} from "@/lib/authz";

export { isDemoActor } from "@/lib/demo";

/**
 * Resolves the signed-in board member from the database, not from the JWT.
 *
 * The token is valid for hours; board membership is not. Re-reading costs one
 * indexed lookup on a table with seven rows, and it means that removing someone
 * or reassigning a role takes effect immediately rather than at token expiry.
 */
export async function currentActor(): Promise<Actor | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;

  /*
    The demo visitor gets a synthetic actor rather than a database lookup: no
    row in `board_users` exists or should.

    It carries NO roles and is not superadmin, which is what makes the board
    portal read-only without a single new check on any mutation. `viewRosters`
    is granted to "any" active board user, so every listing renders; every other
    capability is a role grant, so `assertCapability` throws - and per
    src/lib/authz.ts every server action calls into that before it writes.

    `boardUserId` is deliberately not a UUID. Board mutations stamp it into
    `audit_events.actor_board_user_id`, so if a write ever did slip past the
    capability gate, the foreign key rejects it rather than recording a demo
    visitor as a board member who acted.
  */
  if (session.user.isDemo || email === DEMO_EMAIL) return DEMO_ACTOR;

  return loadBoardIdentity(email);
}

export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  return actor;
}

/**
 * The gate every mutation goes through. Throws on refusal so that forgetting to
 * check produces a failure rather than a silent write.
 */
export async function requireCapability(capability: Capability): Promise<Actor> {
  const actor = await requireActor();
  assertCapability(actor, capability);
  return actor;
}

