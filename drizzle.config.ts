import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Next.js reads .env.local automatically; standalone tooling does not.
config({ path: [".env.local", ".env"], quiet: true });

// Migrations run against the DIRECT connection, never the pooler. drizzle-kit
// wraps DDL in a transaction and relies on session state that PgBouncer's
// transaction pooling does not preserve.
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error("DIRECT_DATABASE_URL (or DATABASE_URL) must be set to run drizzle-kit");
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
