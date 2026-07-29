import NextAuth, { type NextAuthConfig, type DefaultSession } from "next-auth";
// Imported for its side effect on module resolution: without it TypeScript
// cannot locate "next-auth/jwt" as an augmentation target below.
import type {} from "next-auth/jwt";
import Google from "next-auth/providers/google";
import { authConfig } from "@/auth.config";
import { loadBoardIdentity, touchLastLogin, type RoleKey } from "@/lib/authz";
import { linkGoogleMember, lookupMemberByEmail } from "@/lib/member-account";

declare module "next-auth" {
  interface Session {
    user: {
      /** Empty string when the signed-in person is not on the board. */
      boardUserId: string;
      memberId: string;
      roles: RoleKey[];
      isSuperadmin: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    boardUserId?: string;
    memberId?: string;
    memberTokenVersion?: number;
    roles?: RoleKey[];
    isSuperadmin?: boolean;
  }
}

/**
 * Google credentials are not provisioned until the club's Workspace admin
 * issues them. Constructing the provider with an empty client id makes the
 * whole auth route throw at request time, which would take the public trip
 * pages down with it, so the provider is simply absent until configured.
 */
const hasGoogle = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

/**
 * Every Google sign-in must be a CU address - board members included.
 *
 * Checked server-side against the verified email rather than Google's `hd`
 * hint, which is only meaningful for Workspace accounts and is not a control.
 * Subdomains count, so buffs.colorado.edu works.
 *
 * Two separate questions, deliberately kept separate:
 *   WHO YOU ARE   - proven by a CU Google account. This gate.
 *   WHAT YOU MAY DO - the `board_users` table, a manual whitelist the president
 *                     maintains. Signing in never grants board access.
 *
 * A board member therefore needs their CU address in `board_users`, not a
 * personal one. Adding a gmail address to that table will not let it sign in.
 */
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? "colorado.edu")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

export function isAllowedDomain(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  return ALLOWED_DOMAINS.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

export const googleLoginEnabled = hasGoogle;

const providers: NextAuthConfig["providers"] = [];

if (hasGoogle) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Most people have a personal and a CU account signed in at once, so
      // always show the chooser. `hd` is a hint that pre-filters it - the real
      // restriction is the server-side domain check in signIn.
      authorization: { params: { prompt: "select_account", hd: "colorado.edu" } },
    }),
  );
}

/**
 * Google is the only way in, deliberately.
 *
 * There was a development bypass here that skipped the identity provider for
 * board addresses. It was disabled in production builds, but it is gone
 * entirely now: a second door is a second thing to get wrong, and "it only
 * works in dev" is exactly the assumption that stops being true.
 */

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers,
  callbacks: {
    ...authConfig.callbacks,

    /**
     * Anyone with a Google account may sign in as a MEMBER. Board access is a
     * separate question, answered by `loadBoardIdentity` and enforced on
     * /admin - signing in never grants it.
     *
     * Letting any Google account through is deliberate and safe: a member row
     * on its own confers nothing. Claiming a spot still requires dues when the
     * trip demands them, and trip photos are restricted to people who actually
     * went. Every account still has to be a CU one, so the realistic worst case
     * is a student who is not in the club, not an intruder.
     */
    async signIn({ user, account }) {
      const email = user.email;
      if (!email) return false;
      if (account?.provider !== "google") return false;

      // Applies to everyone, board included.
      if (!isAllowedDomain(email)) return "/login?error=AccessDenied";

      const board = await loadBoardIdentity(email);
      if (board) await touchLastLogin(board.boardUserId);

      const linked = await linkGoogleMember({
        sub: account.providerAccountId,
        email,
        name: user.name,
        picture: user.image,
      });
      // A blocked member gets no session at all, board or not.
      return linked !== null;
    },

    /**
     * Roles are written into the token at sign-in so middleware and the nav can
     * read them without a query. They are a cache, not the authority - see
     * `loadBoardIdentity`, which every admin request re-runs.
     */
    async jwt({ token, user, trigger }) {
      const email = user?.email ?? token.email;
      if (!email) return token;

      if (user || trigger === "update" || !token.memberId) {
        const [identity, member] = await Promise.all([
          loadBoardIdentity(email),
          lookupMemberByEmail(email),
        ]);

        token.boardUserId = identity?.boardUserId;
        token.roles = identity?.roles ?? [];
        token.isSuperadmin = identity?.isSuperadmin ?? false;
        token.memberId = member?.id;
        token.memberTokenVersion = member?.tokenVersion;
        token.email = email;
        token.name = identity?.name ?? token.name;
      }

      return token;
    },

    async session({ session, token }) {
      session.user.boardUserId = token.boardUserId ?? "";
      session.user.memberId = token.memberId ?? "";
      session.user.roles = token.roles ?? [];
      session.user.isSuperadmin = token.isSuperadmin ?? false;
      return session;
    },
  },
});
