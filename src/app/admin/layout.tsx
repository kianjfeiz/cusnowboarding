import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { NavStrip, type NavItem } from "@/components/nav-strip";
import { can } from "@/lib/authz";
import { requireActor } from "./_lib/actor";
import { signOutAction } from "./_lib/session-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Board - CU Snowboarding" };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();

  const links: NavItem[] = [
    // Exact, or the dashboard would stay lit on every board page it prefixes.
    { href: "/admin", label: "Dashboard", exact: true },
    { href: "/admin/trips", label: "Trips" },
    { href: "/admin/events", label: "Events" },
    { href: "/admin/payments", label: "Payments" },
    { href: "/admin/members", label: "Members" },
  ];
  if (can(actor, "manageBoard")) links.push({ href: "/admin/settings", label: "Settings" });

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          {/* Same hit-area trick as the member header: taller to the finger,
              unchanged to the layout. */}
          <Link href="/admin" className="-my-2 py-2 text-sm font-semibold tracking-tight">
            CU Snowboarding board
          </Link>

          {/* The same glass strip as the member site, so moving between the
              two halves feels like one product. This layout persists across
              admin navigations, which is what the indicator slides on. */}
          <NavStrip items={links} />

          <div className="ml-auto flex items-center gap-3 text-xs text-ink-faint">
            {/*
              The way back out. A board member is also someone who goes on trips,
              and the member site links in here - without this the board area is
              a one-way door and the only escape is editing the URL.
            */}
            <Link
              href="/"
              className="inline-flex h-9 items-center rounded-md border border-border px-2.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:h-7 sm:px-2"
            >
              Member view
            </Link>
            <span className="hidden sm:inline">{actor.name ?? actor.email}</span>
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

      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}
