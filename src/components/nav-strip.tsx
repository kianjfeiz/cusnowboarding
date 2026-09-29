"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { inkMask } from "@/components/ui";

export type NavItem = {
  href: string;
  label: string;
  /**
   * Route patterns that belong to this tab without being under its href. A `*`
   * segment matches exactly one path segment. Strings, not RegExps: this
   * crosses the RSC boundary.
   */
  covers?: string[];
  /** For a hub that prefixes its siblings: /admin must not stay lit on every board page. */
  exact?: boolean;
  /** Basename of an ink mask in /public/nav. All or nothing per strip. */
  icon?: string;
};

const segments = (value: string) => value.split("/").filter(Boolean);

/** Prefix match by whole segments, where a `*` pattern segment matches any one. */
function matchesPattern(pathname: string, pattern: string) {
  const path = segments(pathname);
  const wanted = segments(pattern);
  return (
    path.length >= wanted.length &&
    wanted.every((segment, i) => segment === "*" || segment === path[i])
  );
}

/**
 * The segment count of the tab's longest matching pattern, or -1. Longest wins
 * so that "/trips/*\/roster" (My trips) beats "/trips" (Home) whatever the
 * tab order.
 */
function claimStrength(pathname: string, item: NavItem): number {
  const ownsPath =
    item.exact || item.href === "/" ? pathname === item.href : matchesPattern(pathname, item.href);
  const claims = (item.covers ?? []).filter((pattern) => matchesPattern(pathname, pattern));
  if (ownsPath) claims.push(item.href);
  return Math.max(-1, ...claims.map((pattern) => segments(pattern).length));
}

/**
 * The active tab is a flat fill one step stronger than the hover fill, plus
 * `aria-current`. Nothing is measured or positioned, so the strip is correct in
 * the server render and needs no effects.
 */
export function NavStrip({
  items,
  className = "",
}: {
  items: NavItem[];
  /** Lets the surrounding header decide where the strip sits when it wraps. */
  className?: string;
}) {
  const pathname = usePathname() ?? "/";
  const strengths = items.map((item) => claimStrength(pathname, item));
  const strongest = Math.max(-1, ...strengths);
  const activeIndex = strongest < 0 ? -1 : strengths.indexOf(strongest);

  // An icon makes each tab nearly square, where `rounded-full` would turn the
  // fill into a circle that changes shape with every label's width.
  const radius = items.some((item) => item.icon) ? "rounded-2xl" : "rounded-full";

  return (
    <nav
      className={`-mx-1 overflow-x-auto px-1 sm:mx-0 sm:overflow-visible sm:px-0 ${className}`}
    >
      <div className="flex w-max items-center gap-1">
        {items.map((item, index) => {
          const active = index === activeIndex;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap ${radius} text-sm transition-colors ${
                item.icon
                  ? "flex flex-col items-center gap-1 px-3 py-1.5 text-[11px] leading-none"
                  : "px-2.5 py-2"
              } ${
                active
                  ? "bg-surface-strong text-ink"
                  : "text-ink-muted hover:bg-surface hover:text-ink"
              }`}
            >
              {item.icon ? (
                <span
                  aria-hidden
                  style={inkMask(`/nav/${item.icon}.png`, "center")}
                  className="h-6 w-6 bg-current"
                />
              ) : null}
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
