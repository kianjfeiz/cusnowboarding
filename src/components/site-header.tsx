import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";
import { Avatar } from "@/components/avatar";

/**
 * Member-facing navigation. The board has its own shell under /admin; this is
 * what everyone else sees.
 */
export async function SiteHeader() {
  const session = await auth();
  const user = session?.user;

  return (
    <header className="border-b border-border bg-paper">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          CU Snowboarding
        </Link>

        <nav className="flex items-center gap-1">
          <Link
            href="/"
            className="rounded-md px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            Trips
          </Link>
          <Link
            href="/calendar"
            className="rounded-md px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            Calendar
          </Link>
          {user ? (
            <Link
              href="/me"
              className="rounded-md px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              My trips
            </Link>
          ) : null}
          {user?.boardUserId ? (
            <Link
              href="/admin"
              className="rounded-md px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              Board
            </Link>
          ) : null}
        </nav>

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
                  className="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface hover:text-ink"
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
                className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface"
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
