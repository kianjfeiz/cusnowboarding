import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * Migrations run against the direct connection. drizzle's migrator wraps DDL in
 * a transaction and takes an advisory lock, neither of which survives
 * PgBouncer's transaction pooling intact.
 */
async function main() {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_DATABASE_URL (or DATABASE_URL) must be set");

  if (!process.env.DIRECT_DATABASE_URL) {
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
