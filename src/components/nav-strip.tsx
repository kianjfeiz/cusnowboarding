"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * `covers` lists route patterns that belong to this tab without being under its
 * href - trip detail pages are reached from Home, so Home claims them. A `*`
 * segment matches exactly one path segment, so "/trips/*\/roster" can hand the
 * roster page to My trips while the trip page under the same slug stays with
 * Home. Patterns must stay strings: this crosses the RSC boundary, where a
 * RegExp cannot.
 *
 * `exact` is for hub pages that are also prefixes of everything beside them -
 * without it, /admin would stay lit on every board page.
 */
export type NavItem = { href: string; label: string; covers?: string[]; exact?: boolean };

type Geometry = { left: number; right: number; trackWidth: number };

const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const LEADING_MS = 320;
const TRAILING_MS = 520;

// The strip renders on the server too, where useLayoutEffect would warn.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Where the indicator sat on the page being left.
 *
 * Module scope rather than component state because every page renders its own
 * `SiteHeader` instead of inheriting one from a layout, so this component
 * remounts on each navigation with no memory of the previous position - and a
 * slide needs somewhere to slide from. Only one strip is ever mounted, so a
 * single slot is enough. `trackWidth` guards the case where the link set
 * changed underneath it (signing in adds two links), which would leave the
 * stored offsets describing a different strip.
 */
let lastGeometry: Geometry | null = null;

/** Prefix match by whole segments, where a `*` pattern segment matches any one. */
function matchesPattern(pathname: string, pattern: string) {
  const path = pathname.split("/").filter(Boolean);
  const wanted = pattern.split("/").filter(Boolean);
  if (path.length < wanted.length) return false;
  return wanted.every((segment, i) => segment === "*" || segment === path[i]);
}

/**
 * How strongly this tab claims the pathname: the segment count of its longest
 * matching pattern, or -1 for no claim. Longest wins so that a specific claim
 * ("/trips/*\/roster" is My trips) beats a broad one ("/trips" is Home)
 * regardless of which tab is listed first.
 */
function claimStrength(pathname: string, item: NavItem): number {
  const segments = (value: string) => value.split("/").filter(Boolean).length;
  let strength = -1;

  for (const pattern of item.covers ?? []) {
    if (matchesPattern(pathname, pattern)) strength = Math.max(strength, segments(pattern));
  }

  if (item.exact || item.href === "/") {
    if (pathname === item.href) strength = Math.max(strength, segments(item.href));
  } else if (matchesPattern(pathname, item.href)) {
    strength = Math.max(strength, segments(item.href));
  }

  return strength;
}

function activeIndexFor(pathname: string, items: NavItem[]): number {
  let best = -1;
  let bestStrength = -1;
  items.forEach((item, index) => {
    const strength = claimStrength(pathname, item);
    if (strength > bestStrength) {
      best = index;
      bestStrength = strength;
    }
  });
  return bestStrength < 0 ? -1 : best;
}

/**
 * Member nav with a glass indicator that slides between links.
 *
 * The two edges are animated separately, with the trailing one given the longer
 * duration, so the pill stretches as it travels and settles into shape at the
 * end rather than sliding rigidly. Which edge is which depends on the direction
 * of travel, hence the swap below.
 *
 * The move runs through the Web Animations API rather than a CSS transition
 * because the indicator is usually starting from a fresh mount, where there is
 * no previously rendered value for a transition to animate away from. Position
 * is written to the DOM directly for the same reason: it has to be correct in
 * the same frame the new page first paints.
 *
 * Offsets are measured inside `track`, which is `w-max`, so they stay correct
 * when the strip is scrolled horizontally on a phone.
 */
export function NavStrip({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? "/";
  const trackRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const activeIndex = activeIndexFor(pathname, items);

  const readGeometry = useCallback((): Geometry | null => {
    const track = trackRef.current;
    const link = activeIndex >= 0 ? linkRefs.current[activeIndex] : null;
    if (!track || !link) return null;

    return {
      left: link.offsetLeft,
      right: track.offsetWidth - (link.offsetLeft + link.offsetWidth),
      trackWidth: track.offsetWidth,
    };
  }, [activeIndex]);

  const place = useCallback((pill: HTMLSpanElement, geometry: Geometry | null) => {
    if (!geometry) {
      pill.style.opacity = "0";
      return;
    }
    pill.style.opacity = "1";
    pill.style.left = `${geometry.left}px`;
    pill.style.right = `${geometry.right}px`;
  }, []);

  // The origin is decided once per destination. React invokes layout effects
  // twice on mount in development, and by the second pass `lastGeometry` is
  // already this page's position - reading it again would make every move look
  // like a move of zero length.
  const originFor = useRef<number | null>(null);
  const origin = useRef<Geometry | null>(null);

  useIsomorphicLayoutEffect(() => {
    const pill = pillRef.current;
    if (!pill) return;

    const target = readGeometry();
    place(pill, target);

    if (!target) {
      lastGeometry = null;
      return;
    }

    if (originFor.current !== activeIndex) {
      originFor.current = activeIndex;
      origin.current =
        lastGeometry && lastGeometry.trackWidth === target.trackWidth ? lastGeometry : null;
    }
    const from = origin.current;
    lastGeometry = target;

    if (!from || (from.left === target.left && from.right === target.right)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const goingLeft = target.left < from.left;
    const moves = [
      pill.animate([{ left: `${from.left}px` }, { left: `${target.left}px` }], {
        duration: goingLeft ? LEADING_MS : TRAILING_MS,
        easing: EASING,
      }),
      pill.animate([{ right: `${from.right}px` }, { right: `${target.right}px` }], {
        duration: goingLeft ? TRAILING_MS : LEADING_MS,
        easing: EASING,
      }),
    ];
    return () => moves.forEach((move) => move.cancel());
  }, [readGeometry, place, activeIndex]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;

    // Catches the font swap and the wrap at the sm breakpoint, both of which
    // move the links without changing the route. Those are re-measures rather
    // than moves, so the indicator snaps.
    let initial = true;
    const observer = new ResizeObserver(() => {
      if (initial) {
        initial = false;
        return;
      }
      const pill = pillRef.current;
      if (!pill) return;
      const geometry = readGeometry();
      lastGeometry = geometry;
      place(pill, geometry);
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [readGeometry, place]);

  return (
    <nav className="-mx-1 overflow-x-auto px-1 sm:mx-0 sm:overflow-visible sm:px-0">
      {/* `w-max` so the indicator's offsets are measured against the whole strip
          and not the visible slice of a scrolled one. */}
      <div ref={trackRef} className="relative flex w-max items-center gap-1">
        {/* Positioned by the layout effect above, so it starts out invisible
            rather than parked at the left edge for a frame. */}
        <span
          ref={pillRef}
          aria-hidden
          style={{ opacity: 0 }}
          className="nav-glass pointer-events-none absolute inset-y-0 left-0 right-0 rounded-full backdrop-blur-xl backdrop-saturate-200"
        />

        {items.map((item, index) => {
          const active = index === activeIndex;
          return (
            <Link
              key={item.href}
              href={item.href}
              ref={(node) => {
                linkRefs.current[index] = node;
              }}
              aria-current={active ? "page" : undefined}
              className={`relative shrink-0 whitespace-nowrap rounded-full px-2.5 py-2 text-sm transition-colors ${
                active ? "text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
