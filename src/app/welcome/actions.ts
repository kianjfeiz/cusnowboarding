"use server";

import { redirect } from "next/navigation";
import { execute } from "@/lib/db";
import { getMemberSession } from "@/lib/member-session";
import { safeNextPath } from "@/lib/request";
import { loadVerifiedMember } from "@/lib/verification";

/**
 * Saves the name the member just typed and stamps it confirmed, which is what
 * stops the arm bridge detouring them back here on the next sign-in.
 *
 * Identity comes from the claim cookie, which arm minted on the same response
 * that redirected here - deliberately not from the Google session, so this
 * page works identically for the dev provider and any future sign-in method.
 */
export async function confirmNameAction(formData: FormData): Promise<void> {
  const session = await getMemberSession();
  const member = session
    ? await loadVerifiedMember(session.memberId, session.tokenVersion)
    : null;
  if (!member) redirect("/login");

  const firstName = String(formData.get("firstName") ?? "").trim().slice(0, 60);
  const lastName = String(formData.get("lastName") ?? "").trim().slice(0, 60);
  // The base only anchors the origin-unchanged check; any fixed value works.
  const next = safeNextPath(String(formData.get("next") ?? ""), "http://n", "/me");

  if (!firstName || !lastName) {
    redirect(`/welcome?error=missing&next=${encodeURIComponent(next)}`);
  }

  await execute(
    `update members
        set first_name = $2, last_name = $3, name_confirmed_at = now(), updated_at = now()
      where id = $1`,
    [member.id, firstName, lastName],
  );

  redirect(next);
}
