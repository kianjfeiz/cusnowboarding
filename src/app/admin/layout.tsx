import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { can } from "@/lib/authz";
import { requireActor } from "./_lib/actor";
import { signOutAction } from "./_lib/session-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Board - CU Snowboarding" };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();

  const links: Array<{ href: string; label: string }> = [
    { href: "/admin", label: "Dashboard" },
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
          <Link href="/admin" className="text-sm font-semibold tracking-tight">
            CU Snowboarding board
          </Link>

          <nav className="flex items-center gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-xs text-ink-faint">
            {/*
              The way back out. A board member is also someone who goes on trips,
              and the member site links in here - without this the board area is
              a one-way door and the only escape is editing the URL.
            */}
            <Link
              href="/"
              className="rounded-md border border-border px-2 py-1 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              Member view
            </Link>
            <span className="hidden sm:inline">{actor.name ?? actor.email}</span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-md px-2 py-1 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
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
