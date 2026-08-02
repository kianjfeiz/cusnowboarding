import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";
import { Avatar } from "@/components/avatar";
import { NavStrip, type NavItem } from "@/components/nav-strip";

/**
 * Member-facing navigation. The board has its own shell under /admin; this is
 * what everyone else sees.
 */
export async function SiteHeader() {
  const session = await auth();
  const user = session?.user;

  const navItems: NavItem[] = [
    // Trip pages are reached from the Home list, so Home stays lit there.
    { href: "/", label: "Home", covers: ["/trips"] },
    { href: "/calendar", label: "Calendar" },
    ...(user ? [{ href: "/me", label: "My trips" }] : []),
    ...(user?.boardUserId ? [{ href: "/admin", label: "Board" }] : []),
  ];

  return (
    <header className="border-b border-border bg-paper">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
        {/* `-my-2 py-2` buys the wordmark a finger-sized hit area without
            adding any height to the header row. */}
        <Link href="/" className="-my-2 py-2 text-sm font-semibold tracking-tight">
          CU Snowboarding
        </Link>

        {/* Same reasoning as the board header: the strip scrolls, not the page. */}
        <NavStrip items={navItems} />

        <div className="ml-auto flex items-center gap-3">
          {user ? (
            <>
              <Avatar
                src={user.image}
                name={user.name ?? user.email ?? "Member"}
                size={28}
              />
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
            </>
          ) : (
            <form
              action={async () => {
                "use server";
                // Signing in also arms the claim cookie, so a member who signs
                // in is immediately ready for the next drop.
                await signIn("google", { redirectTo: "/api/member/arm?next=/me" });
              }}
            >
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md border border-border-strong px-3 text-xs font-medium transition-colors hover:bg-surface sm:h-8"
              >
                Sign in with Google
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
