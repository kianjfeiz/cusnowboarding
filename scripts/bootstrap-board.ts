import { config } from "dotenv";
import { Client } from "pg";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * Creates the first board member so a fresh deployment can be signed into:
 * /admin is gated on `board_users`, and the UI for adding one is inside /admin.
 * It inserts the role catalogue and one superadmin and touches nothing else.
 *
 *   npm run board:bootstrap -- president@colorado.edu "Your Name"
 *
 * Idempotent - running it twice reports the existing row rather than failing.
 */

const BOARD_ROLES = [
  { key: "president", label: "President", sort: 10 },
  { key: "vp", label: "Vice President", sort: 20 },
  { key: "treasurer", label: "Treasurer", sort: 30 },
  { key: "travel", label: "Travel Coordinator", sort: 40 },
  { key: "merch", label: "Merch Coordinator", sort: 50 },
  { key: "events", label: "Events Coordinator", sort: 60 },
  { key: "media", label: "Media Coordinator", sort: 70 },
];

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  const name = (process.argv[3] ?? "").trim() || null;

  if (!email) {
    throw new Error('usage: npm run board:bootstrap -- president@colorado.edu "Your Name"');
  }

  const domain = email.split("@")[1] ?? "";
  if (!(domain === "colorado.edu" || domain.endsWith(".colorado.edu"))) {
    throw new Error(
      `${email} is not a CU address. Sign-in only accepts colorado.edu, so this account could never sign in.`,
    );
  }

  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL must be set");

  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const client = new Client({
    connectionString: url,
    ssl: isLocal ? undefined : { rejectUnauthorized: true },
  });
  await client.connect();

  try {
    for (const role of BOARD_ROLES) {
      await client.query(
        `insert into board_roles (key, label, sort) values ($1, $2, $3)
         on conflict (key) do nothing`,
        [role.key, role.label, role.sort],
      );
    }

    // Emails are citext, so this also catches a differently-cased duplicate.
    const inserted = await client.query<{ id: string }>(
      `insert into board_users (email, name, is_superadmin) values ($1, $2, true)
       on conflict (email) do nothing
       returning id`,
      [email, name],
    );

    if (inserted.rowCount === 0) {
      const existing = await client.query<{ id: string; is_superadmin: boolean }>(
        `select id, is_superadmin from board_users where email = $1`,
        [email],
      );
      const row = existing.rows[0];
      console.log(
        `${email} is already a board user${row?.is_superadmin ? " (superadmin)" : ""}. Nothing to do.`,
      );
      return;
    }

    await client.query(
      `insert into board_user_roles (board_user_id, role_key, term_year)
       values ($1, 'president', extract(year from now())::int)
       on conflict do nothing`,
      [inserted.rows[0].id],
    );

    console.log(`Board roles ready (${BOARD_ROLES.length}).`);
    console.log(`Superadmin created: ${email}`);
    console.log("Sign in with that Google account, then add the rest of the board in Settings.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
