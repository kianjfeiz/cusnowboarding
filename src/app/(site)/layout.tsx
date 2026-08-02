import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";

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
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
