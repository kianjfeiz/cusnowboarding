"use server";

import { signIn } from "@/auth";

/**
 * Signing in also arms the browser for one-click trip entry, which is why the
 * redirect goes through /api/member/arm rather than straight to a page. See
 * that route for why the claim path reads its own cookie instead of the
 * session.
 */
export async function signInWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/api/member/arm?next=/me" });
}
