import { config } from "dotenv";
import { Client } from "pg";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * `docker compose up -d` returns as soon as the containers start, not when
 * Postgres is accepting queries. Both endpoints are probed because PgBouncer
 * can be listening before its upstream is reachable.
 */
async function probe(url: string, label: string, deadline: number) {
  let lastError: unknown;

  while (Date.now() < deadline) {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      console.log(`  ${label} ready`);
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`${label} did not become ready in time: ${String(lastError)}`);
}

async function main() {
  const direct = process.env.DIRECT_DATABASE_URL;
  const pooled = process.env.DATABASE_URL;

  if (!pooled) throw new Error("DATABASE_URL is not set");

  const deadline = Date.now() + 60_000;
  console.log("Waiting for database...");
  if (direct) await probe(direct, "postgres  (5432)", deadline);
  await probe(pooled, "pgbouncer (6432)", deadline);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
