import { config } from "dotenv";
import { Client } from "pg";
import { claimSpot, generatePayToken } from "../src/lib/claims/claim";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * Fires a burst of entries at a trip, the way a real drop does.
 *
 * For demonstrating the board flow with a populated roster. Unlike the race
 * suite this claims through the pooled connection each member would use, so the
 * ordering it produces is the real thing rather than a fixture.
 *
 *   npx tsx scripts/simulate-entrants.ts <trip-slug> [count]
 */
async function main() {
  const slug = process.argv[2];
  const count = Number(process.argv[3] ?? 30);
  if (!slug) throw new Error("usage: simulate-entrants.ts <trip-slug> [count]");

  const url = process.env.DATABASE_URL!;
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error("Refusing to run against a non-local database.");
  }

  const admin = new Client({ connectionString: url });
  await admin.connect();

  const { rows: trips } = await admin.query<{ id: string; title: string }>(
    `select id, title from trips where slug = $1`,
    [slug],
  );
  if (!trips[0]) throw new Error(`No trip with slug ${slug}`);

  const { rows: members } = await admin.query<{ id: string; first_name: string }>(
    `select id, first_name from members
      where email_verified_at is not null and is_club_member and not is_blocked
      order by email
      limit $1`,
    [count],
  );

  // Warmed, dedicated connections so the burst is genuinely concurrent.
  const clients = members.map(() => new Client({ connectionString: url }));
  await Promise.all(clients.map((c) => c.connect()));
  await Promise.all(clients.map((c) => c.query("select 1")));

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));

  const claims = members.map(async (member, i) => {
    await gate;
    return claimSpot(clients[i], trips[0].id, member.id, generatePayToken());
  });

  const startedAt = Date.now();
  release();
  const results = await Promise.all(claims);
  const elapsed = Date.now() - startedAt;

  const tally = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`${trips[0].title}: ${members.length} entries in ${elapsed}ms`);
  for (const [outcome, n] of Object.entries(tally)) console.log(`  ${outcome.padEnd(12)} ${n}`);

  await Promise.all(clients.map((c) => c.end()));
  await admin.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
