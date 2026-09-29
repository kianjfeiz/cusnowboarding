import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button, Field, Input, Notice } from "@/components/ui";
import { currentMember } from "@/lib/auth/current-member";
import { safeNextPath } from "@/lib/request";
import { confirmNameAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Welcome - CU Snowboarding" };

/**
 * The one-time name ask after a first Google sign-in. Google's profile name is
 * a guess, and whatever lands in `members` is what the treasurer reconciles
 * payments against - so the member confirms it once, prefilled.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const member = await currentMember();
  if (!member) redirect("/login");

  const { next, error } = await searchParams;
  const destination = safeNextPath(next ?? null, "http://n", "/me");

  // An old link back here should not re-ask.
  if (member.nameConfirmedAt !== null) redirect(destination);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-12">
      <p className="text-sm text-ink-muted">CU Snowboarding</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">
        What is your name?
      </h1>
      <p className="mt-3 text-sm text-ink-muted">
        As it should appear on trip rosters and ride sheets.
      </p>

      {error === "missing" ? (
        <div className="mt-4">
          <Notice tone="alert">Both names are needed.</Notice>
        </div>
      ) : null}

      <form action={confirmNameAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={destination} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <Input
              name="firstName"
              required
              maxLength={60}
              defaultValue={member.firstName}
              autoComplete="given-name"
              autoFocus
            />
          </Field>
          <Field label="Last name">
            <Input
              name="lastName"
              required
              maxLength={60}
              defaultValue={member.lastName}
              autoComplete="family-name"
            />
          </Field>
        </div>
        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    </main>
  );
}
