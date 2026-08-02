import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

config({ path: [".env.local", ".env"], quiet: true });

const BOARD_ROLES = [
  { key: "president", label: "President", sort: 10 },
  { key: "vp", label: "Vice President", sort: 20 },
  { key: "treasurer", label: "Treasurer", sort: 30 },
  { key: "travel", label: "Travel Coordinator", sort: 40 },
  { key: "merch", label: "Merch Coordinator", sort: 50 },
  { key: "events", label: "Events Coordinator", sort: 60 },
  { key: "media", label: "Media Coordinator", sort: 70 },
];

const FIRST_NAMES = [
  "Avery", "Blake", "Cameron", "Dakota", "Emerson", "Finley", "Grayson", "Harper",
  "Indigo", "Jordan", "Kai", "Logan", "Marlow", "Noel", "Oakley", "Parker",
  "Quinn", "Reese", "Sawyer", "Tatum", "Urban", "Vale", "Wren", "Xen", "Yuri", "Zion",
];
const LAST_NAMES = [
  "Alvarez", "Bennett", "Castillo", "Delgado", "Ellison", "Fournier", "Gallagher",
  "Huang", "Ibarra", "Jensen", "Kowalski", "Lindqvist", "Moreau", "Nakamura",
  "Okafor", "Petrov", "Quintana", "Rasmussen", "Sandoval", "Thibault",
];

function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 3_600_000);
}

async function main() {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_DATABASE_URL (or DATABASE_URL) must be set");

  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  if (!isLocal && process.env.ALLOW_REMOTE_SEED !== "true") {
    throw new Error(
      "Refusing to seed a non-local database. Set ALLOW_REMOTE_SEED=true if this is intentional.",
    );
  }

  const pool = new Pool({
    connectionString: url,
    ssl: isLocal ? undefined : { rejectUnauthorized: true },
    max: 4,
  });
  const db = drizzle(pool, { schema, casing: "snake_case" });

  await db.insert(schema.boardRoles).values(BOARD_ROLES).onConflictDoNothing();
  console.log(`board roles: ${BOARD_ROLES.length}`);

  const [president] = await db
    .insert(schema.boardUsers)
    .values({
      // Must be a CU address: sign-in rejects any other domain, so a personal
      // address in board_users can never actually reach the admin.
      email: "kife1762@colorado.edu",
      name: "Club President",
      isSuperadmin: true,
    })
    .onConflictDoNothing()
    .returning();

  if (president) {
    await db
      .insert(schema.boardUserRoles)
      .values({ boardUserId: president.id, roleKey: "president", termYear: 2026 })
      .onConflictDoNothing();
  }
  console.log("board users: 1 (president, superadmin)");

  // 200 verified members. The race suite needs enough distinct, already-verified
  // members that no test has to create them on the hot path.
  const memberRows = Array.from({ length: 200 }, (_, i) => {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 7) % LAST_NAMES.length];
    return {
      email: `rider${String(i + 1).padStart(3, "0")}@colorado.edu`,
      firstName: first,
      lastName: last,
      phone: `303555${String(1000 + i).slice(-4)}`,
      emailVerifiedAt: new Date(),
      isClubMember: true,
    };
  });
  await db.insert(schema.members).values(memberRows).onConflictDoNothing();
  console.log(`members: ${memberRows.length} (verified, dues paid)`);

  const [openTrip] = await db
    .insert(schema.trips)
    .values({
      slug: "winter-park-jan-24",
      title: "Winter Park - Jan 24",
      resort: "Winter Park",
      departAt: hoursFromNow(24 * 30),
      returnAt: hoursFromNow(24 * 32),
      description: "Two nights, Airbnb in Fraser. Lift tickets not included.",
      priceCents: 8500,
      capacity: 25,
      waitlistCap: 50,
      // Already open, so the public claim page is immediately exercisable.
      signupOpensAt: hoursFromNow(-1),
      signupPhrase: "first chair fraser",
      paymentWindowHours: 48,
      requiresDues: true,
      paymentUrl: "https://club.fusionfamily.com/@/cusportclubs",
      status: "open",
      createdBy: president?.id,
    })
    .onConflictDoNothing()
    .returning();

  const [scheduledTrip] = await db
    .insert(schema.trips)
    .values({
      slug: "breckenridge-feb-14",
      title: "Breckenridge - Feb 14",
      resort: "Breckenridge",
      departAt: hoursFromNow(24 * 60),
      returnAt: hoursFromNow(24 * 62),
      description: "Three nights. The big one.",
      priceCents: 14500,
      capacity: 25,
      waitlistCap: 50,
      // Scheduled but not yet open, for exercising the countdown.
      signupOpensAt: hoursFromNow(2),
      signupPhrase: "send it breck",
      paymentWindowHours: 48,
      requiresDues: true,
      paymentUrl: "https://club.fusionfamily.com/@/cusportclubs",
      status: "scheduled",
      createdBy: president?.id,
    })
    .onConflictDoNothing()
    .returning();

  console.log(
    `trips: ${[openTrip, scheduledTrip].filter(Boolean).length} (1 open, 1 scheduled)`,
  );

  await pool.end();
  console.log("\nSeed complete.");
  if (openTrip) console.log(`  open trip:      /trips/${openTrip.slug}`);
  if (scheduledTrip) console.log(`  scheduled trip: /trips/${scheduledTrip.slug}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
