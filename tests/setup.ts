import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

// Tests exercise the database layer directly and do not need OAuth or provider
// keys present. src/env.ts honours this flag.
process.env.SKIP_ENV_VALIDATION = "true";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and run `npm run db:up`.",
  );
}

/**
 * The race suite writes thousands of signups against real member rows and the
 * helpers run `delete from trips where slug like 'test-trip-%'`. One stale
 * shell variable is all it would take to point that at production, so refuse
 * anything that is not obviously a local database. Mirrors the guard in
 * src/lib/db/seed.ts.
 */
if (
  !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) &&
  process.env.ALLOW_REMOTE_TESTS !== "true"
) {
  throw new Error(
    "Refusing to run destructive tests against a non-local database. " +
      "Set ALLOW_REMOTE_TESTS=true only if you are certain.",
  );
}
