import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, googleLoginEnabled } from "@/auth";
import { Notice } from "@/components/ui";
import { GoogleMark } from "@/components/google-mark";
import { Wordmark } from "@/components/wordmark";
import { demoEnabled } from "@/lib/demo";
import { DemoForm } from "./demo-form";
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
  searchParams: Promise<{ error?: string }>;
}) {
  // Anyone already signed in belongs on the site, not here. Board members get
  // /admin; everyone else gets their trips.
  const session = await auth();
  if (session?.user?.boardUserId) redirect("/admin");
  if (session?.user) redirect("/me");

  const { error } = await searchParams;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      {/*
        What the glass sits on. Two very soft accent washes well outside the
        card, so the panel has something to refract rather than floating on a
        flat fill - glass over nothing reads as a grey box. Deliberately dim
        and aria-hidden: this is light, not content.
      */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[18%] h-[26rem] w-[26rem] -translate-x-[70%] rounded-full bg-accent-soft opacity-70 blur-3xl" />
        <div className="absolute left-1/2 bottom-[12%] h-[22rem] w-[22rem] -translate-x-[10%] rounded-full bg-surface-strong opacity-80 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="rise mb-8 flex flex-col items-center gap-3 text-center">
          <Wordmark />
          <p className="text-sm text-ink-muted">
            Trips, rosters, and the drop - for the CU Boulder snowboarding club.
          </p>
        </div>

        {/*
          `relative` and `overflow-hidden` are what the sheen needs: .glass-panel
          paints it as an inset ::before, so it has to be positioned and clipped
          to the panel's own radius.
        */}
        <section
          className="glass-panel rise relative overflow-hidden rounded-2xl p-7 backdrop-blur-xl"
          style={{ "--rise-delay": "70ms" } as React.CSSProperties}
        >
          {/* Above the sheen, which is inset:1px and would otherwise sit over
              the controls and mute them. */}
          <div className="relative">
            {error ? (
              <div className="mb-5">
                <Notice tone="alert">
                  {ERRORS[error] ?? "Something went wrong. Try again."}
                </Notice>
              </div>
            ) : null}

            {googleLoginEnabled ? (
              <form action={signInWithGoogle}>
                {/*
                  Google's own button, not the site's accent one: their mark
                  belongs on a neutral surface at their published proportions,
                  and a blue-on-blue button would be both off-brand and harder
                  to read. Hand-rolled rather than <Button> for that reason.
                */}
                <button
                  type="submit"
                  className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-border-strong bg-paper text-sm font-medium text-ink transition-[background-color,transform,box-shadow] duration-150 hover:bg-surface active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100"
                >
                  <GoogleMark />
                  Sign in with Google
                </button>
              </form>
            ) : (
              <Notice tone="alert">
                Sign-in is not configured yet. AUTH_GOOGLE_ID and
                AUTH_GOOGLE_SECRET need to be set.
              </Notice>
            )}

            {/* ink-muted, not ink-faint: this is the answer to "which account
                do I use", which is the question people actually arrive with.
                The faint tone is for furniture, and it does not clear AA at
                this size either. */}
            <p className="mt-4 text-center text-xs text-ink-muted">
              Any CU Boulder address. Board access is granted separately.
            </p>

            {/* Absent entirely without DEMO_PASSWORD - no form, and no provider
                behind it either, so there is nothing to probe. */}
            {demoEnabled() ? <DemoForm /> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
