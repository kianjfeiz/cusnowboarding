import Link from "next/link";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { clubPaymentUrl } from "@/lib/payments";

/**
 * Everything member-facing shares this layout so the header renders once and
 * then persists across client navigations - switching tabs swaps only the page
 * content instead of re-rendering (and re-awaiting the session for) the whole
 * document. It also gives the nav indicator a stable mount to slide on.
 *
 * The trip photo gallery lives OUTSIDE this group, at
 * `src/app/trips/[slug]/photos`, because it deliberately carries no site
 * header - just its own back link to the trip. The two trees serve disjoint
 * URLs, so they coexist.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  const paymentUrl = clubPaymentUrl();

  return (
    <>
      <SiteHeader />
      {children}

      {/*
        The signoff. The oversized wordmark is set in the palette's quietest
        tone and cropped by the page edge - furniture, not a message, which is
        why it is aria-hidden and unselectable. The links above it are the
        short list a member actually goes looking for at the bottom of a page.
      */}
      <footer className="mt-20 overflow-hidden border-t border-border">
        <div className="mx-auto max-w-4xl px-5">
          <nav className="flex flex-wrap gap-x-6 gap-y-2 py-6 text-sm text-ink-muted">
            <Link href="/calendar" className="py-1 transition-colors hover:text-ink">
              Calendar
            </Link>
            <Link href="/me" className="py-1 transition-colors hover:text-ink">
              My trips
            </Link>
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
          </nav>
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
