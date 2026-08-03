import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card, Notice, formatDenver, formatMoney } from "@/components/ui";
import { loadPayState, paymentUrlFor, type PaySignup } from "@/lib/payments";
import { PageShell, StatusLink, SummaryCard } from "../status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pay for your spot - CU Snowboarding" };

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await loadPayState(token);

  if (state.kind === "not_found") notFound();
  const signup = state.signup;

  if (state.kind === "pending") {
    return (
      <PageShell title="Entry received">
        <SummaryCard signup={signup} standing="Entry received" />
        <Notice title="Results have not gone out yet">
          The board sends results shortly after signups close. You will get an
          email either way, and nothing is owed until then.
        </Notice>
        <StatusLink payToken={signup.payToken} />
      </PageShell>
    );
  }

  /*
    A board seat is `paid` for zero, so without this it would render as "the
    treasurer recorded your payment of $0.00" - which reads like a bug to the
    one audience that would recognise it as one. Ahead of the paid branch
    because it is a more specific case of it.
  */
  if (signup.boardSeat) {
    return (
      <PageShell title="You are on the trip">
        <SummaryCard signup={signup} standing="Board seat" />
        <Notice tone="accent" title="Nothing to pay">
          Board seats are comped, so there is no payment and no deadline on this
          one. You are on the trip.
        </Notice>
        <StatusLink payToken={signup.payToken} />
      </PageShell>
    );
  }

  if (state.kind === "paid") {
    return (
      <PageShell title="Paid">
        <SummaryCard signup={signup} standing={`Spot ${signup.spotNumber ?? ""}`} />
        <Notice tone="accent" title="You are confirmed">
          <p>
            The treasurer recorded your payment of {formatMoney(signup.amountCents)}
            {signup.paidAt ? ` on ${formatDenver(signup.paidAt)}` : ""}. Nothing
            more to do.
          </p>
          {signup.offlineNote ? (
            <p className="mt-2 text-xs text-ink-faint">Recorded as: {signup.offlineNote}</p>
          ) : null}
        </Notice>
        <StatusLink payToken={signup.payToken} />
      </PageShell>
    );
  }

  if (state.kind === "waitlisted") {
    return (
      <PageShell title="On the waitlist">
        <SummaryCard signup={signup} standing="Waitlisted" />
        <Notice title="Nothing to pay yet">
          You only owe anything if a spot opens up and the coordinators give it
          to you. If that happens you will get an email with the amount and a
          deadline.
        </Notice>
        <StatusLink payToken={signup.payToken} />
      </PageShell>
    );
  }

  if (state.kind === "lapsed") {
    return (
      <PageShell title="This hold has lapsed">
        <SummaryCard signup={signup} standing="Released" />
        <Notice tone="alert" title="The spot went back to the waitlist">
          The payment deadline passed. Talk to the trip coordinator if you still
          want to go - if the trip has not filled you may be able to get back on.
        </Notice>
        <StatusLink payToken={signup.payToken} />
      </PageShell>
    );
  }

  return (
    <PageShell title="Pay for your spot">
      <SummaryCard signup={signup} standing={`Spot ${signup.spotNumber ?? ""}`} />
      <DueSection signup={signup} />
      <StatusLink payToken={signup.payToken} />
    </PageShell>
  );
}

/**
 * The handoff to Fusion.
 *
 * The club bills through CU's Fusion club-sports portal, which this app cannot
 * see into - there is no API to ask whether someone paid. So the page is
 * explicit that paying and being marked paid are two separate events, and that
 * the second one is a person doing it by hand. Saying so here is what stops a
 * member paying on Fusion, seeing "unpaid" an hour later, and assuming their
 * money went nowhere.
 */
function DueSection({ signup }: { signup: PaySignup }) {
  const url = paymentUrlFor(signup);

  return (
    <div className="space-y-4">
      <Card className="text-center">
        <p className="text-sm text-ink-muted">Amount due</p>
        <p className="tnum mt-1 text-4xl font-semibold">{formatMoney(signup.amountCents)}</p>
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
            Pay on the club portal
          </a>
        ) : (
          <div className="mt-5 text-left">
            <Notice tone="alert" title="No payment link set">
              Nobody has added the payment link for this trip yet. Ask the
              treasurer where to send it.
            </Notice>
          </div>
        )}
      </Card>

      <Notice title="After you pay">
        Payment goes through the club portal, which this site cannot check
        automatically. The treasurer marks you paid once they reconcile it, so
        this page may still show a balance for a day or so. Your spot is safe as
        long as you paid before the deadline - keep the receipt.
      </Notice>
    </div>
  );
}
