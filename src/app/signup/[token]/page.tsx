import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Notice, formatDenver, formatMoney } from "@/components/ui";
import { loadPayState } from "@/lib/payments";
import { PageShell, SummaryCard } from "../../pay/status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your signup - CU Snowboarding" };

/**
 * The bookmarkable counterpart to /pay/<token>: same token, same lazy expiry
 * rules, but read-only. Members get this link in every email so "where do I
 * stand" never requires asking the board.
 */
export default async function SignupStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const state = await loadPayState(token);

  if (state.kind === "not_found") notFound();

  const signup = state.signup;

  return (
    <PageShell title={`Hi ${signup.firstName}`} subtitle="Here is where your signup stands.">
      <SummaryCard signup={signup} standing={STANDING[state.kind](signup)} />
      {BODY[state.kind](signup)}
      <p className="mt-6 text-center text-xs text-ink-faint">
        Trip details are on the{" "}
        <a className="text-accent underline underline-offset-4" href={`/trips/${signup.tripSlug}`}>
          trip page
        </a>
        .
      </p>
    </PageShell>
  );
}

type Signup = Extract<Awaited<ReturnType<typeof loadPayState>>, { kind: "due" }>["signup"];
type Kind = "paid" | "due" | "waitlisted" | "lapsed" | "pending";

const STANDING: Record<Kind, (s: Signup) => string> = {
  pending: () => "Entry received",
  paid: (s) => `Confirmed - spot ${s.spotNumber}`,
  due: (s) => `Held - spot ${s.spotNumber}`,
  // No number: the board picks from the waitlist rather than working down it.
  waitlisted: () => "Waitlisted",
  lapsed: () => "No longer held",
};

const BODY: Record<Kind, (s: Signup) => React.ReactNode> = {
  pending: () => (
    <Notice title="Results have not gone out yet">
      Your entry is in. The board sends results shortly after signups close, and
      you will get an email either way.
    </Notice>
  ),
  paid: () => (
    <Notice tone="accent" title="You are on the trip">
      Payment is recorded and your spot is confirmed. Watch your email for departure
      details closer to the day.
    </Notice>
  ),
  due: (s) => (
    <Notice tone="accent" title="Payment is outstanding">
      <p>
        {formatMoney(s.amountCents)} is due by{" "}
        {s.paymentDeadlineAt ? formatDenver(s.paymentDeadlineAt) : "the deadline"}. After
        that the spot goes to the waitlist.
      </p>
      <p className="mt-3">
        <a
          className="font-medium text-accent underline underline-offset-4"
          href={`/pay/${s.payToken}`}
        >
          Pay now
        </a>
      </p>
    </Notice>
  ),
  waitlisted: () => (
    <Notice title="You are on the waitlist">
      Nothing to pay yet. Spots do open when people drop or holds go unpaid, and
      the coordinators pull from the waitlist when they do. You will get an email
      with the amount and a deadline if you get one.
    </Notice>
  ),
  lapsed: () => (
    <Notice tone="alert" title="This signup is closed">
      The hold on this spot was released. You can rejoin the waitlist from the trip
      page, or email the board if you think this is wrong.
    </Notice>
  ),
};
