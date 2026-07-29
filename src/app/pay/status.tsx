import type { ReactNode } from "react";
import { Badge, Card, formatDenver, formatMoney } from "@/components/ui";
import type { PaySignup } from "@/lib/payments";

/**
 * The pay page and the bookmarkable status page show the same signup from two
 * angles, so the chrome and the trip summary live here rather than being
 * written twice and drifting apart.
 */
export function PageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-xl px-5 py-12">
      <header className="mb-8">
        <p className="text-sm text-ink-muted">CU Snowboarding</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-2 text-sm text-ink-muted">{subtitle}</p> : null}
      </header>
      {children}
    </main>
  );
}

export function SummaryCard({
  signup,
  standing,
}: {
  signup: PaySignup;
  standing: string;
}) {
  return (
    <Card className="mb-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge emphasis="strong">{standing}</Badge>
        <Badge>{formatMoney(signup.amountCents)}</Badge>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <Detail label="Trip">{signup.tripTitle}</Detail>
        {signup.resort ? <Detail label="Resort">{signup.resort}</Detail> : null}
        <Detail label="Departs">{formatDenver(signup.departAt)}</Detail>
        {signup.returnAt ? (
          <Detail label="Returns">{formatDenver(signup.returnAt)}</Detail>
        ) : null}
        {signup.spotNumber !== null ? (
          <Detail label="Spot">
            <span className="tnum">{signup.spotNumber}</span>
          </Detail>
        ) : null}
        {/*
          No waitlist position is shown. The board pulls from the waitlist by
          judgement rather than working strictly down it, so a number would
          promise a queue that is not how the decision gets made.
        */}
      </dl>
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

export function StatusLink({ payToken }: { payToken: string }) {
  return (
    <p className="mt-6 text-center text-xs text-ink-faint">
      Bookmark{" "}
      <a className="text-accent underline underline-offset-4" href={`/signup/${payToken}`}>
        your status page
      </a>{" "}
      to check on this later.
    </p>
  );
}
