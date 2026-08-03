import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";
import { Avatar } from "@/components/avatar";
import { NavStrip, type NavItem } from "@/components/nav-strip";
import { Wordmark } from "@/components/wordmark";

/**
 * Member-facing navigation. The board has its own shell under /admin; this is
 * what everyone else sees.
 */
export async function SiteHeader() {
  const session = await auth();
  const user = session?.user;

  const navItems: NavItem[] = [
    // Trip pages are reached from the Home list, so Home stays lit there.
    { href: "/", label: "Home", covers: ["/trips"], icon: "home" },
    { href: "/calendar", label: "Calendar", icon: "calendar" },
    ...(user
      ? [
          {
            href: "/me",
            label: "My trips",
            // All only ever reached from My trips, and the longer claims
            // outrank Home's blanket hold on /trips.
            covers: ["/trips/*/roster", "/trips/*/rides", "/pay"],
            icon: "trips",
          },
        ]
      : []),
    ...(user?.boardUserId ? [{ href: "/admin", label: "Board", icon: "admin" }] : []),
  ];

  return (
    <header className="border-b border-border bg-paper">
      {/*
        Three things that fit on one line on a laptop and cannot on a phone: the
        wordmark is 140px, the four drawn tabs another 270, and the account
        controls 100 more. Left to wrap on its own each took a row of its own,
        and the header ate the top third of the screen.

        So the phone gets a deliberate two-row header instead of an accidental
        three-row one - identity and account together, the nav across the full
        width below them, where it can also scroll. `order-last` is what moves
        the strip under a block that follows it in the DOM, and the DOM order is
        the one that should be read aloud: what this is, then where to go.
      */}
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        {/* `-my-2 py-2` buys the wordmark a finger-sized hit area without
            adding any height to the header row. */}
        <Link href="/" className="-my-2 py-2 text-ink" aria-label="CU Snowboarding home">
          <Wordmark />
        </Link>

        {/* Same reasoning as the board header: the strip scrolls, not the page. */}
        <NavStrip
          items={navItems}
          className="order-last w-full sm:order-none sm:w-auto"
        />

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
