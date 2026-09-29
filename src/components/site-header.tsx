import Link from "next/link";
import { auth, signOut } from "@/auth";
import { Avatar } from "@/components/avatar";
import { NavStrip, type NavItem } from "@/components/nav-strip";
import { Wordmark } from "@/components/wordmark";

/**
 * Member-facing navigation; the board has its own shell under /admin. Every
 * page under this header is behind sign-in (middleware), so there is no
 * signed-out state to render.
 */
export async function SiteHeader() {
  const session = await auth();
  const user = session?.user;

  const navItems: NavItem[] = [
    // Trip pages are reached from the Home list, so Home stays lit there.
    { href: "/", label: "Home", covers: ["/trips"], icon: "home" },
    { href: "/calendar", label: "Calendar", icon: "calendar" },
    // Every gallery lives under /photos, so the prefix match keeps the tab lit.
    { href: "/photos", label: "Photos", icon: "photos" },
    { href: "/sponsors", label: "Sponsors", icon: "sponsors" },
    {
      href: "/me",
      label: "My trips",
      // Only ever reached from My trips; the longer claims outrank Home's
      // blanket hold on /trips.
      covers: ["/trips/*/roster", "/trips/*/rides", "/pay"],
      icon: "trips",
    },
    ...(user?.boardUserId ? [{ href: "/admin", label: "Board", icon: "admin" }] : []),
  ];

  return (
    <header className="border-b border-border bg-paper">
      {/* On a phone: identity and account on one row, the nav across the
          full width below, where it can scroll. `order-last` moves the strip
          without changing the DOM order a screen reader follows. */}
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        {/* `-my-2 py-2`: a finger-sized hit area without adding header height. */}
        <Link href="/" className="-my-2 py-2 text-ink" aria-label="CU Snowboarding home">
          <Wordmark />
        </Link>

        <NavStrip items={navItems} className="order-last w-full sm:order-none sm:w-auto" />

        {user ? (
          <div className="ml-auto flex items-center gap-3">
            <Avatar src={user.image} name={user.name ?? user.email ?? "Member"} size={28} />
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md px-2.5 text-xs text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:h-7 sm:px-2"
              >
                Sign out
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </header>
  );
}
