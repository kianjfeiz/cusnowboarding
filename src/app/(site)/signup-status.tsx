import Link from "next/link";
import { Notice, cn, formatDenver, formatMoney } from "@/components/ui";
import type { Standing } from "@/lib/roster/standing";

/**
 * The words for where a signup stands, shared by the home page, My trips, the
 * trip page and the pay page so they cannot drift apart. No waitlist position
 * anywhere: the board picks from the waitlist rather than working down it.
 */
export const STANDING_LABEL: Record<Standing, string> = {
  board: "Board seat",
  pending: "Entry received",
  paid: "Confirmed",
  waitlisted: "Waitlisted",
  // Covers a lapsed hold and anyone the board took off the trip or the waitlist.
  lapsed: "Not on the trip",
  due: "Payment due",
};

/**
 * Fusion is invisible to this site, so being marked paid always lags paying.
 * Said wherever a balance is shown, or a member who paid an hour ago reads it
 * as their money having vanished.
 */
export function PaidLagNote({ className = "mt-2" }: { className?: string }) {
  return (
    <p className={cn(className, "text-xs text-ink-muted")}>
      Paid on Fusion already? It can take a day for the treasurer to mark it here.
      Your spot is safe if you paid before the deadline.
    </p>
  );
}

export function dueLine(signup: { amountCents: number; paymentDeadlineAt: Date | null }) {
  const deadline = signup.paymentDeadlineAt
    ? formatDenver(signup.paymentDeadlineAt)
    : "the deadline";
  return `${formatMoney(signup.amountCents)} due by ${deadline}`;
}

/** The one way into paying, wherever a balance is shown. */
export function PayNowLink({ payToken }: { payToken: string }) {
  return (
    <Link
      href={`/pay/${payToken}`}
      className="inline-flex h-9 shrink-0 items-center rounded-md bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85"
    >
      Pay now
    </Link>
  );
}

export function StandingNotice({
  standing,
  signup,
}: {
  standing: Standing;
  signup: {
    amountCents: number;
    paymentDeadlineAt: Date | null;
    payToken: string;
    paidAt?: Date | null;
    offlineNote?: string | null;
  };
}) {
  switch (standing) {
    case "pending":
      return (
        <Notice title="Entry received">
          The board releases the roster soon after signups close. If you get a
          spot, you get an email; either way it shows here.{" "}
          {signup.amountCents === 0
            ? "There is no payment for this trip."
            : "Nothing to pay until then."}
        </Notice>
      );

    case "board":
      // Ahead of `paid`: a board seat is paid-for-zero, and "your payment of
      // $0.00 was recorded" reads like a bug.
      return (
        <Notice tone="accent" title="You are on the trip">
          Board seat - nothing to pay.
        </Notice>
      );

    case "paid":
      if (signup.amountCents === 0) {
        return (
          <Notice tone="accent" title="You are on the trip">
            No payment required. Nothing more to do.
          </Notice>
        );
      }
      return (
        <Notice tone="accent" title="You are on the trip">
          <p>
            Payment of {formatMoney(signup.amountCents)} recorded
            {signup.paidAt ? ` on ${formatDenver(signup.paidAt)}` : ""}. Nothing more to do.
          </p>
          {signup.offlineNote ? (
            <p className="mt-1 text-xs text-ink-faint">Recorded as: {signup.offlineNote}</p>
          ) : null}
        </Notice>
      );

    case "waitlisted":
      return (
        <Notice title="You are on the waitlist">
          Nothing to pay. If the board moves you onto the trip, it shows here
          {signup.amountCents === 0 ? "" : " with the amount and deadline"}. There is
          no email for that, so check back.
        </Notice>
      );

    case "lapsed":
      return (
        <Notice tone="alert" title="You are not on this trip">
          Your place was released, usually because the payment deadline passed.
          Talk to the trip coordinator if you still want to go.
        </Notice>
      );

    case "due":
      return (
        <Notice tone="accent" title="Your spot is held">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="tnum font-medium text-ink">{dueLine(signup)}</p>
            <PayNowLink payToken={signup.payToken} />
          </div>
          <PaidLagNote />
        </Notice>
      );
  }
}
