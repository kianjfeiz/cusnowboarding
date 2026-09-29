import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card, Notice, PageHeader, formatDenver, formatMoney } from "@/components/ui";
import { loadPayState, paymentUrlFor, type PaySignup } from "@/lib/money/payments";
import { StandingNotice } from "../../signup-status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your signup - CU Snowboarding" };

/**
 * One signup, by its token: where it stands, and how to pay when money is owed.
 * This is the link in the roster release email, so it is also the page a member
 * bookmarks to check back on.
 */
export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await loadPayState(token);
  if (state.kind === "not_found") notFound();

  const signup = state.signup;
  // `loadPayState` applies lazy expiry and holds back the outcome until the
  // roster is released; a board seat is its paid-for-zero special case.
  const standing = state.kind === "paid" && signup.boardSeat ? "board" : state.kind;

  return (
    <main className="mx-auto max-w-xl px-5 py-12">
      <PageHeader back="/me" backLabel="My trips" title={signup.tripTitle}>
        <p className="mt-2 text-sm text-ink-muted">
          {signup.resort ? `${signup.resort} · ` : ""}
          {formatDenver(signup.departAt)}
        </p>
      </PageHeader>

      {standing === "due" ? (
        <DueSection signup={signup} />
      ) : (
        <StandingNotice standing={standing} signup={signup} />
      )}

      <p className="mt-6 text-center text-sm">
        <Link
          className="text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
          href={`/trips/${signup.tripSlug}`}
        >
          Trip page
        </Link>
      </p>
    </main>
  );
}

/**
 * The handoff to Fusion. This app cannot see into the portal, so the copy must
 * say that paying and being marked paid are two separate events - otherwise a
 * member pays, still sees a balance an hour later, and assumes the money went
 * nowhere.
 */
function DueSection({ signup }: { signup: PaySignup }) {
  const url = paymentUrlFor(signup);

  return (
    <Card className="text-center">
      <p className="text-sm font-medium text-ink">Your spot is held</p>
      <p className="tnum mt-2 text-4xl font-semibold">{formatMoney(signup.amountCents)}</p>
      {signup.paymentDeadlineAt ? (
        <p className="mt-3 text-sm text-ink-muted">
          Due by {formatDenver(signup.paymentDeadlineAt)}
        </p>
      ) : null}

      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Pay on Fusion
        </a>
      ) : (
        <div className="mt-5 text-left">
          <Notice tone="alert" title="No payment link yet">
            Ask the treasurer where to pay.
          </Notice>
        </div>
      )}

      <p className="mt-4 text-xs text-ink-muted">
        After you pay, it can take a day for the treasurer to mark you paid here.
        Your spot is safe if you paid before the deadline - keep the receipt.
      </p>
    </Card>
  );
}
