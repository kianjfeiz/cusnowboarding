import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  assertCapability,
  loadBoardIdentity,
  type Actor,
  type Capability,
} from "@/lib/auth/authz";

/**
 * Resolves the signed-in board member from the database, not from the JWT: the
 * token is valid for hours, and removing someone or reassigning a role has to
 * take effect on their next request. Cached per request only - the layout,
 * the page and an action share one read, and the next request reads afresh.
 */
export const currentActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;

  return loadBoardIdentity(email);
});

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
