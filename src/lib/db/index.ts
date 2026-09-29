import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

declare global {
  var __cusnowPool: Pool | undefined;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

const poolConfig: PoolConfig = {
  connectionString,
  ssl: isLocal ? undefined : { rejectUnauthorized: true },
  // Serverless functions are short-lived and the pooler does the real pooling;
  // a large local pool just holds connections the platform will discard.
  max: isLocal ? 20 : 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  /**
   * A claim that cannot get the trip row lock within 4s should fail fast rather
   * than pile up behind a drop-night queue and exhaust the pool.
   *
   * LOCAL ONLY as startup options: Neon's pooler REJECTS any connection
   * carrying them, which fails every query, not just claims. Production gets
   * the same timeouts from `alter role ... set` instead (see docs/DEPLOY.md).
   */
  ...(isLocal ? { options: "-c lock_timeout=4000 -c statement_timeout=10000" } : {}),
};

// Next.js dev server hot-reloads modules; without this every reload leaks a pool.
export const pool = global.__cusnowPool ?? new Pool(poolConfig);
if (process.env.NODE_ENV !== "production") global.__cusnowPool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });

/**
 * Runs `work` in one transaction on one connection. A result of `{ ok: false }`
 * is a refusal and rolls back, so a refused action leaves nothing behind.
 * Anything touching spots or waitlist positions goes through `withTripLock`
 * (lib/roster/promotion.ts) rather than calling this directly.
 */
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    const refused =
      typeof result === "object" && result !== null && "ok" in result && result.ok === false;
    await client.query(refused ? "rollback" : "commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Raw single-statement escape hatch. The claim path uses this deliberately:
 * one statement is one implicit transaction and one round trip, which is what
 * makes it safe under transaction-mode pooling.
 */
export async function execute<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}
