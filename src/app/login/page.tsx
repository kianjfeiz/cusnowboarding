import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, googleLoginEnabled } from "@/auth";
import { Button, Notice } from "@/components/ui";
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-12">
      <h1 className="text-center text-2xl font-semibold tracking-tight">
        CU Snowboarding
      </h1>

      {error ? (
        <div className="mt-6">
          <Notice tone="alert">{ERRORS[error] ?? "Something went wrong. Try again."}</Notice>
        </div>
      ) : null}

      <div className="mt-8">
        {googleLoginEnabled ? (
          <form action={signInWithGoogle}>
            <Button type="submit" className="h-12 w-full">
              Sign in with Google
            </Button>
          </form>
        ) : (
          <Notice tone="alert">
            Sign-in is not configured yet. AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET
            need to be set.
          </Notice>
        )}
      </div>
    </main>
  );
}
