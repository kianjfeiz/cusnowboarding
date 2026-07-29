import { config } from "dotenv";
import { Client, Pool } from "pg";
import { randomBytes } from "node:crypto";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * Dress rehearsal for a drop.
 *
 * Fires N simultaneous claims at a throwaway trip and reports what actually
 * happened: how the spots were allocated, how long the burst took, and the
 * latency spread. Run this against a preview deployment backed by a copy of
 * production before any real signup night.
 *
 *   npm run drop:rehearse                 # 100 claimers, capacity 25, local
 *   CLAIMERS=200 CAPACITY=25 npm run drop:rehearse
 *
 * It talks to the database directly, so it measures the claim statement rather
 * than the HTTP stack. For the full request path use:
 *   CLAIM_TEST_URL=https://... npx vitest run tests/http-claim.test.ts
 */

const CLAIMERS = Number(process.env.CLAIMERS ?? 100);
const CAPACITY = Number(process.env.CAPACITY ?? 25);

const CLAIM_SQL_PATH = "src/lib/claims/claim.ts";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const admin = new Pool({
    connectionString: process.env.DIRECT_DATABASE_URL ?? url,
    ssl: isLocal ? undefined : { rejectUnauthorized: true },
    max: 4,
  });

  const { claimSpot, generatePayToken } = await import("../src/lib/claims/claim");

  console.log(`Rehearsal: ${CLAIMERS} simultaneous claimers, capacity ${CAPACITY}`);
  console.log(`Target: ${url.replace(/:[^:@]+@/, ":****@")}\n`);

  const { rows: members } = await admin.query<{ id: string }>(
    `select id from members
      where email_verified_at is not null and is_blocked = false
      order by email limit $1`,
    [CLAIMERS],
  );

  if (members.length < CLAIMERS) {
    throw new Error(
      `Need ${CLAIMERS} verified members, found ${members.length}. Run \`npm run db:seed\`.`,
    );
  }

  const slug = `rehearsal-${randomBytes(4).toString("hex")}`;
  const { rows: trips } = await admin.query<{ id: string }>(
    `insert into trips (slug, title, depart_at, price_cents, capacity, waitlist_cap,
                        signup_opens_at, requires_dues, status)
     values ($1, $2, now() + interval '30 days', 8500, $3, null,
             now() - interval '1 minute', false, 'open')
     returning id`,
    [slug, `Rehearsal ${slug}`, CAPACITY],
  );
  const tripId = trips[0].id;

  // Warm every connection first, so the burst measures contention on the trip
  // row rather than TLS handshakes.
  process.stdout.write("Opening and warming connections... ");
  const clients = Array.from({ length: CLAIMERS }, () => new Client({ connectionString: url }));
  for (const client of clients) client.on("error", () => {});
  await Promise.all(clients.map((c) => c.connect()));
  await Promise.all(clients.map((c) => c.query("select 1")));
  console.log("done\n");

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const latencies: number[] = [];
  const claims = clients.map(async (client, i) => {
    await gate;
    const startedAt = performance.now();
    const result = await claimSpot(client, tripId, members[i].id, generatePayToken());
    latencies.push(performance.now() - startedAt);
    return result;
  });

  const burstStart = performance.now();
  release();
  const results = await Promise.all(claims);
  const burstMs = performance.now() - burstStart;

  await Promise.all(clients.map((c) => c.end().catch(() => {})));

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});

  const { rows: spots } = await admin.query<{ spot_number: number | null; n: number }>(
    `select spot_number, count(*)::int as n from signups
      where trip_id = $1 and spot_number is not null
      group by spot_number order by spot_number`,
    [tripId],
  );

  const sorted = [...latencies].sort((a, b) => a - b);

  console.log("Outcomes");
  for (const [outcome, count] of Object.entries(counts).sort()) {
    console.log(`  ${outcome.padEnd(12)} ${count}`);
  }

  console.log("\nTiming");
  console.log(`  whole burst   ${burstMs.toFixed(0)} ms`);
  console.log(`  median claim  ${percentile(sorted, 50).toFixed(1)} ms`);
  console.log(`  p95 claim     ${percentile(sorted, 95).toFixed(1)} ms`);
  console.log(`  slowest claim ${(sorted.at(-1) ?? 0).toFixed(1)} ms`);

  const duplicateSpots = spots.filter((s) => s.n > 1);
  const held = counts.held ?? 0;

  console.log("\nChecks");
  const checks: Array<[string, boolean]> = [
    [`exactly ${CAPACITY} spots issued`, held === CAPACITY],
    ["no spot issued twice", duplicateSpots.length === 0],
    [
      "spot numbers are 1..capacity with no gaps",
      spots.length === CAPACITY && spots.every((s, i) => s.spot_number === i + 1),
    ],
    ["everyone got an answer", results.length === CLAIMERS],
  ];

  let allPassed = true;
  for (const [label, passed] of checks) {
    console.log(`  ${passed ? "pass" : "FAIL"}  ${label}`);
    if (!passed) allPassed = false;
  }

  await admin.query(`delete from trips where id = $1`, [tripId]);
  await admin.end();

  if (!allPassed) {
    console.log(`\nSomething is wrong. Do not run a real drop. Start at ${CLAIM_SQL_PATH}.`);
    process.exit(1);
  }

  console.log("\nAll checks passed. Rehearsal trip deleted.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
