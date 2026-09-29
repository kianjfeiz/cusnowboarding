import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { NavStrip, type NavItem } from "@/components/nav-strip";
import { Wordmark } from "@/components/wordmark";
import { can } from "@/lib/auth/authz";
import { requireActor } from "./_lib/actor";
import { signOutAction } from "./_lib/session-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Board - CU Snowboarding" };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();

  const links: NavItem[] = [
    // Exact, or the dashboard would stay lit on every board page it prefixes.
    { href: "/admin", label: "Dashboard", exact: true, icon: "dashboard" },
    { href: "/admin/trips", label: "Trips", icon: "trips" },
    { href: "/admin/events", label: "Events", icon: "calendar" },
    { href: "/admin/sponsors", label: "Sponsors", icon: "sponsors" },
    { href: "/admin/payments", label: "Payments", icon: "payments" },
    { href: "/admin/members", label: "Members", icon: "members" },
  ];
  if (can(actor, "manageBoard")) {
    links.push({ href: "/admin/settings", label: "Settings", icon: "settings" });
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-paper">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          {/* Negative margin plus padding: taller to the finger, unchanged
              to the layout. */}
          <Link
            href="/admin"
            className="-my-2 flex items-center gap-2 py-2 text-ink"
            aria-label="CU Snowboarding board home"
          >
            <Wordmark />
            <span aria-hidden className="text-sm font-semibold tracking-tight text-ink-muted">
              board
            </span>
          </Link>

          <NavStrip items={links} className="order-last w-full sm:order-none sm:w-auto" />

          <div className="ml-auto flex items-center gap-3 text-xs text-ink-faint">
            {/* The way back out: a board member is also a member. */}
            <Link
              href="/"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:h-7 sm:px-2"
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Back to member site
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md px-2.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:h-7 sm:px-2"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}
