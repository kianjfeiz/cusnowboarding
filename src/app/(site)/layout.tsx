import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { clubPaymentUrl } from "@/lib/money/payments";

/**
 * Shared by everything member-facing so the header renders once and persists
 * across client navigations instead of re-awaiting the session per tab switch.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  const paymentUrl = clubPaymentUrl();

  return (
    <>
      <SiteHeader />
      {children}

      {/* The oversized wordmark is furniture, hence aria-hidden and unselectable. */}
      <footer className="mt-20 overflow-hidden border-t border-border">
        <div className="mx-auto max-w-4xl px-5">
          {/* The header already carries the tabs; the footer holds only what
              it does not - the club's own payment portal. */}
          <div className="py-6 text-sm text-ink-muted">
            {paymentUrl ? (
              <a
                href={paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="py-1 transition-colors hover:text-ink"
              >
                Pay dues on Fusion
              </a>
            ) : null}
          </div>
          <p
            aria-hidden="true"
            className="select-none whitespace-nowrap text-[17vw] font-semibold leading-none tracking-tighter text-surface-strong sm:text-[7.5rem]"
          >
            CU SNOWBOARDING
          </p>
        </div>
      </footer>
    </>
  );
}
