import type { NextAuthConfig } from "next-auth";

/**
 * The edge-safe half of the auth setup.
 *
 * `src/middleware.ts` imports this file and nothing else, so it must never
 * reach the database driver: pulling `pg` into the middleware bundle breaks the
 * edge build. Providers and every callback that touches Postgres live in
 * `src/auth.ts`, which only ever runs in the Node runtime.
 */
export const authConfig = {
  // Seven board members and no adapter tables. A signed JWT carries the board
  // user id and role keys, so middleware can gate /admin without a DB read.
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  providers: [],
  callbacks: {
    /**
     * Presence check only. Capability enforcement is deliberately not done here
     * - middleware sees a token, not the current database state, and a stale
     * token must never be the thing that decides whether a mutation is allowed.
     * Every page and action re-derives capabilities server-side.
     */
    authorized({ auth }) {
      // Presence only. Everything the middleware matches is behind sign-in, and
      // the matcher in middleware.ts is what decides which paths those are.
      // Capability enforcement is deliberately NOT done here: middleware sees a
      // token, not current database state, and a stale token must never be what
      // decides whether a mutation is allowed. Pages and actions re-derive.
      return Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;
