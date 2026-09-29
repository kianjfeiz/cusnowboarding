import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, googleLoginEnabled } from "@/auth";
import { Notice } from "@/components/ui";
import { GoogleMark } from "@/components/google-mark";
import { Wordmark } from "@/components/wordmark";
import { loginDestination } from "@/lib/request";
import { signInWithGoogle } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in - CU Snowboarding" };

const ERRORS: Record<string, string> = {
  AccessDenied: "Use your CU Boulder account to sign in.",
  Configuration: "Sign-in is not configured yet.",
  Verification: "That sign-in link has expired. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;

  // The page middleware bounced them from, reduced to a path on this site, so
  // a trip link tapped on a signed-out phone still ends on that trip page.
  const next = loginDestination(callbackUrl);

  const session = await auth();
  if (session?.user?.boardUserId) redirect("/admin");
  if (session?.user) redirect(next);

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-xs">
        <div className="mb-8 flex justify-center">
          <Wordmark />
        </div>

        {error ? (
          <div className="mb-4">
            <Notice tone="alert">{ERRORS[error] ?? "Something went wrong. Try again."}</Notice>
          </div>
        ) : null}

        {googleLoginEnabled ? (
          <form action={signInWithGoogle.bind(null, next)}>
            {/* Not <Button>: Google's mark belongs on a neutral surface. */}
            <button
              type="submit"
              className="flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-border-strong bg-paper text-sm font-medium text-ink transition-colors hover:bg-surface"
            >
              <GoogleMark />
              Sign in with Google
            </button>
          </form>
        ) : (
          <Notice tone="alert">
            Sign-in is not configured yet. AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET need to be set.
          </Notice>
        )}

        {/* ink-muted: the faint tone does not clear AA at this size. */}
        <p className="mt-4 text-center text-xs text-ink-muted">Use your CU email.</p>
      </div>
    </main>
  );
}
