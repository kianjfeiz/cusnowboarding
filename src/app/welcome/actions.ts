"use server";

import { redirect } from "next/navigation";
import { execute } from "@/lib/db";
import { currentMember } from "@/lib/auth/current-member";
import { safeNextPath } from "@/lib/request";

/**
 * Stamps the name confirmed, which is what stops the arm route detouring the
 * member back here on the next sign-in. Identity comes from the claim cookie
 * that arm minted on the response that redirected here.
 */
export async function confirmNameAction(formData: FormData): Promise<void> {
  const member = await currentMember();
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
