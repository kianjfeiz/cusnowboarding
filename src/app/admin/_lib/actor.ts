import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  assertCapability,
  loadBoardIdentity,
  type Actor,
  type Capability,
} from "@/lib/authz";

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
