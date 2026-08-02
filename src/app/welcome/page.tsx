import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button, Field, Input, Notice } from "@/components/ui";
import { getMemberSession } from "@/lib/member-session";
import { safeNextPath } from "@/lib/request";
import { loadVerifiedMember } from "@/lib/verification";
import { confirmNameAction } from "./actions";
import { WelcomeUrlGuard } from "./url-guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Welcome - CU Snowboarding" };

/**
 * The one-time name ask after a first Google sign-in.
 *
 * Google's profile name is a guess - often a nickname, sometimes nothing but
 * the email's local-part - and whatever lands in `members` is what the
 * treasurer reconciles payments against, what the roster prints, and what a
 * photo credit says. So the member types it once, here, prefilled with the
 * best guess so most people just correct or confirm.
 *
 * Standalone chrome like /login: this is an interstitial with one job, not a
 * page anyone navigates around from.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const session = await getMemberSession();
  const member = session
    ? await loadVerifiedMember(session.memberId, session.tokenVersion)
    : null;
  if (!member) redirect("/login");

  const { next, error } = await searchParams;
  const destination = safeNextPath(next ?? null, "http://n", "/me");

  // Refreshing after saving, or following an old link back here, should not
  // re-ask. The answer is already on file.
  if (member.nameConfirmedAt !== null) redirect(destination);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-12">
      <WelcomeUrlGuard />
      <div className="rise">
        <p className="text-sm text-ink-muted">CU Snowboarding</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          What is your name?
        </h1>
        <p className="mt-3 text-sm text-ink-muted">
          This is how you will appear on trip rosters, the ride sheet, and to
          the treasurer when payments are matched up - so make it the name
          people actually know you by.
        </p>

        {error === "missing" ? (
          <div className="mt-4">
            <Notice tone="alert">Both names are needed.</Notice>
          </div>
        ) : null}

        <form action={confirmNameAction} className="mt-6 space-y-4">
          <input type="hidden" name="next" value={destination} />
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
          <Button type="submit" className="w-full">
            Continue
          </Button>
        </form>
      </div>
    </main>
  );
}
