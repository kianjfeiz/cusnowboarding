import { Client, Pool } from "pg";

/**
 * Setup and assertions use the direct connection; claims deliberately go
 * through PgBouncer (DATABASE_URL) so the tests exercise the same
 * transaction-pooled path as production.
 */
export const setupPool = new Pool({
  connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
  max: 8,
});

export const POOLED_URL = process.env.DATABASE_URL!;

export interface TestTripOptions {
  capacity?: number;
  waitlistCap?: number | null;
  priceCents?: number;
  requiresDues?: boolean;
  status?: string;
  signupOpensAt?: string;
  paymentWindowHours?: number;
  /**
   * Defaults to released, because most tests exercise what happens after
   * outcomes are public. Pass false to test the pre-release gate itself: an
   * unreleased trip must never have its holds reaped, since nobody has been
   * told they hold a spot.
   */
  resultsReleased?: boolean;
}

let tripCounter = 0;

export async function createTestTrip(opts: TestTripOptions = {}): Promise<string> {
  const {
    capacity = 25,
    waitlistCap = null,
    priceCents = 8500,
    requiresDues = false,
    status = "open",
    signupOpensAt = "now() - interval '1 minute'",
    paymentWindowHours = 48,
    resultsReleased = true,
  } = opts;

  const slug = `test-trip-${process.pid}-${++tripCounter}-${Date.now()}`;
  const { rows } = await setupPool.query<{ id: string }>(
    `insert into trips (
       slug, title, depart_at, return_at, price_cents, capacity, waitlist_cap,
       signup_opens_at, payment_window_hours, requires_dues, status,
       signup_phrase, results_released_at
     ) values ($1, $2, now() + interval '30 days', now() + interval '31 days', $3, $4, $5,
       ${signupOpensAt}, $6, $7, $8::trip_status,
       'test phrase', ${resultsReleased ? "now()" : "null"})
     returning id`,
    [slug, `Test ${slug}`, priceCents, capacity, waitlistCap, paymentWindowHours, requiresDues, status],
  );
  return rows[0].id;
}

/** Verified, dues-paying members created by the seed script. */
export async function getMemberIds(count: number): Promise<string[]> {
  const { rows } = await setupPool.query<{ id: string }>(
    `select id from members
      where email_verified_at is not null and is_blocked = false
      order by email
      limit $1`,
    [count],
  );
  if (rows.length < count) {
    throw new Error(
      `Need ${count} verified members but found ${rows.length}. Run \`npm run db:seed\`.`,
    );
  }
  return rows.map((r) => r.id);
}

export interface SignupRow {
  id: string;
  member_id: string;
  claim_seq: number;
  status: string;
  spot_number: number | null;
  waitlist_position: number | null;
}

export async function getSignups(tripId: string): Promise<SignupRow[]> {
  const { rows } = await setupPool.query(
    `select id, member_id, claim_seq::int as claim_seq, status::text as status,
            spot_number, waitlist_position
       from signups where trip_id = $1 order by claim_seq`,
    [tripId],
  );
  return rows as SignupRow[];
}

export async function getClaimCounter(tripId: string): Promise<number> {
  const { rows } = await setupPool.query<{ c: number }>(
    `select claim_counter::int as c from trips where id = $1`,
    [tripId],
  );
  return rows[0].c;
}

export async function deleteTestTrips(): Promise<void> {
  await setupPool.query(`delete from trips where slug like 'test-trip-%'`);
}

/**
 * Opens N dedicated connections and warms each one, so that when the burst is
 * released the only work left is the claim statement itself. Warming collapses
 * the dispatch window to a few milliseconds, which is far more contention than
 * a real drop produces.
 */
export async function openWarmClients(n: number): Promise<Client[]> {
  const clients = Array.from({ length: n }, () => new Client({ connectionString: POOLED_URL }));
  // The crash-safety test severs sockets on purpose; without a listener pg
  // re-emits that as an uncaught exception and fails the run.
  for (const c of clients) c.on("error", () => {});
  await Promise.all(clients.map((c) => c.connect()));
  await Promise.all(clients.map((c) => c.query("select 1")));
  return clients;
}

export async function closeClients(clients: Client[]): Promise<void> {
  await Promise.all(clients.map((c) => c.end().catch(() => {})));
}

/** Releases every waiting caller at once. */
export function makeGate() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

export const sortedRange = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => i + from);
