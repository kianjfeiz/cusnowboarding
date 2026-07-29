"use server";

import { signIn } from "@/auth";
import { devLoginEnabled } from "@/auth";

/**
 * Signs in as a board member without Google, for LOCAL DEVELOPMENT ONLY.
 *
 * Guarded a third time here - on top of the two gates on the provider itself -
 * so that even if this action were somehow reachable in production it refuses.
 * The provider would not exist there, but defence in depth on an auth bypass is
 * cheap.
 */
export async function devSignIn(formData: FormData): Promise<void> {
  if (!devLoginEnabled) {
    throw new Error("Development sign-in is not enabled");
  }
  const email = String(formData.get("email") ?? "").trim();
  await signIn("dev", { email, redirectTo: "/api/member/arm?next=/admin" });
}
