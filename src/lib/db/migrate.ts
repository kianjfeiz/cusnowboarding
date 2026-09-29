import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * Migrations run against the direct connection: drizzle's migrator wraps DDL in
 * a transaction and takes an advisory lock, neither of which survives
 * PgBouncer's transaction pooling.
 *
 * This is also the first half of the Vercel build (`buildCommand` in
 * vercel.json), so a deployment's schema exists before its code serves a
 * request. A failed migration must fail the build: code reading a column the
 * database lacks surfaces as Auth.js `AccessDenied` for every member.
 */
async function main() {
  // Preview deployments point at the production database, so only a production
  // deploy migrates. A broken preview is cheaper than an unreviewed schema
  // change landing on production when someone opens a pull request.
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") {
    console.log(`Skipping migrations: VERCEL_ENV is "${vercelEnv}", not "production".`);
    return;
  }

  // On Vercel the fallback below would be the pooler, which the migrator cannot
  // use reliably. Fail with the reason rather than half-apply a migration.
  const direct = process.env.DIRECT_DATABASE_URL;
  if (process.env.VERCEL && !direct) {
    throw new Error(
      "DIRECT_DATABASE_URL is not set on this deployment. Add Neon's unpooled " +
        "connection string to the project's environment variables.",
    );
  }

  const url = direct ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_DATABASE_URL (or DATABASE_URL) must be set");

  if (!direct) {
    console.warn("DIRECT_DATABASE_URL is not set; migrating over the pooled connection.");
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({
    connectionString: url,
    ssl: isLocal ? undefined : { rejectUnauthorized: true },
    max: 1,
  });

  // drizzle-kit does not manage extensions, and the schema depends on citext.
  await pool.query("create extension if not exists citext");
  await pool.query("create extension if not exists pgcrypto");

  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();

  console.log("Migrations applied.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
