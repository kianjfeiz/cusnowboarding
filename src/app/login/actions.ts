"use server";

import { signIn } from "@/auth";
import { loginDestination } from "@/lib/request";

/**
 * The redirect goes through /api/member/arm so that signing in also mints the
 * claim cookie. `next` is re-validated because it round-trips through the
 * browser.
 */
export async function signInWithGoogle(next?: string): Promise<void> {
  const path = loginDestination(next);
  await signIn("google", {
    redirectTo: `/api/member/arm?next=${encodeURIComponent(path)}`,
  });
}
