"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { DEMO_PROVIDER, demoEnabled } from "@/lib/demo";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Signing in also arms the browser for one-click trip entry, which is why the
 * redirect goes through /api/member/arm rather than straight to a page. See
 * that route for why the claim path reads its own cookie instead of the
 * session.
 */
export async function signInWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/api/member/arm?next=/me" });
}

export interface DemoFormState {
  error?: string;
}

/**
 * Password-only demo access.
 *
 * Deliberately NOT routed through /api/member/arm the way Google sign-in is: a
 * demo visitor must never hold the claim cookie, and the shortest way to
 * guarantee that is never to visit the route that mints it.
 *
 * Rate limited because a single shared password is the entire secret, and a
 * public login form with no ceiling is a password oracle. Falls back to the
 * in-process limiter when Upstash is absent, which is weaker across serverless
 * instances but still closes the trivial case.
 */
export async function signInWithDemo(
  _prev: DemoFormState,
  formData: FormData,
): Promise<DemoFormState> {
  if (!demoEnabled()) return { error: "Demo access is not available." };

  const forwarded = (await headers()).get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  const { success } = await rateLimit("demo-login", ip, 8, 600);
  if (!success) return { error: "Too many attempts. Try again in a few minutes." };

  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "Enter the demo password." };

  /*
    `redirect: false` is load-bearing, and not for the obvious reason. With the
    default, next-auth's signIn resolves the Auth.js response itself and issues
    the redirect, so a refused password never reaches the catch below - the form
    just bounces back to /login saying nothing. With it, signIn throws
    CredentialsSignin and the form can say what happened.
  */
  try {
    await signIn(DEMO_PROVIDER, { password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) return { error: "That password is not right." };
    throw error;
  }

  // Outside the try: redirect() signals by throwing, and catching it here would
  // swallow the successful sign-in and report it as a bad password.
  redirect("/");
}
