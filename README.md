# CU Snowboarding

Trip signups and payments for the CU Boulder snowboarding club. Live at
cusnowboarding.com.


Next.js 15 (App Router) and TypeScript, Postgres through Drizzle, Auth.js with
Google sign-in, hosted on Vercel with Neon. Photos go to Cloudflare R2 and mail
goes through Resend. Both are optional in development.

## Core functionality

Signups open at a set time and everyone races for a fixed number of spots.

Ordering is decided in Postgres rather than in the browser. One SQL statement
increments a counter on the trip row. The row lock on that UPDATE serialises
everyone claiming at once, and the value each request gets back is its arrival
position. Capacity is then arithmetic. If n is less than or equal to capacity
the member takes spot n, otherwise they land at waitlist position n minus
capacity.

That statement is in [src/lib/claims/claim.ts](src/lib/claims/claim.ts). Read
the comment above it before changing anything. A capacity check written as
`where (select count(*) ...) < capacity` looks correct and is not. It reads a
snapshot and oversells under concurrency.
[tests/isolation.test.ts](tests/isolation.test.ts) reproduces that failure on
purpose so it does not come back later.

Members enter by typing a phrase the board sets on each trip instead of clicking
a button. A button rewards whatever clicks fastest, which is a script. Matching
ignores case and extra spaces.

The slow work all happens before the drop. Signing in issues a signed cookie
that lasts 180 days. At claim time the route verifies that cookie in process and
goes straight to the SQL statement. There is no way to sign in during a drop.

Entrants see only "entry received" until the board publishes. The board curates
the roster first, then presses Send results once. That closes signups, publishes
outcomes, resets every payment deadline, and opens the attendee list, all in one
transaction. Members never see a waitlist number, because the board picks from
the waitlist instead of working down it in order.

Board members ride free and do not count against capacity. A capacity of 25
means 25 paying riders plus however many board members are coming.

## Payments

The club bills through CU's Fusion club-sports portal because the school
requires it. Fusion has no public API, so this app cannot see whether anyone has
paid.

Fusion owns the money. Members are sent there by a link stored in
`trips.payment_url`, which falls back to `NEXT_PUBLIC_PAYMENT_URL`.

This app owns the roster and the deadline. Setting `signups.status` to `paid`
records that the treasurer reconciled a payment, not that one was observed.

Paying and being marked paid are separate events that can be days apart, and the
member-facing copy says so. There is no webhook to build against.

## Local development

Needs Node 22+ and Docker.

```bash
npm install
cp .env.example .env.local     # then fill in the generated-secret fields
npm run db:up                  # postgres on 55432, pgbouncer on 6432
npm run db:migrate
npm run db:seed
npm run dev
```

Generate secrets with `openssl rand -base64 32`. Without a `RESEND_API_KEY` all
mail is printed to the server log instead of sent, so the whole flow works
offline. The seed creates two trips, 200 verified members, the board roles, and
one superadmin. It refuses to run against a non-local database.

Sign-in is Google only in every environment. There is no local bypass, so
development exercises the same path members use.

The app always connects through PgBouncer in transaction mode, which matches
Neon in production. Migrations and seeding use the direct connection instead.
Running the tests through the pooler is the only way to show the claim statement
is safe there.

## Tests

```bash
npm test                                    # everything
npm run test:race                           # the concurrency suite
RACE_ITERATIONS=200 npm run test:race       # full soak before a real drop
```

The race suite opens 100 pre-warmed connections through PgBouncer and fires them
at a trip with 25 spots. It asserts 25 held rows numbered 1 through 25, 75
waitlisted rows with contiguous positions, a gapless total ordering, and no
duplicates. It runs 25 iterations by default, since one passing run of a race
test does not show much.

The suite also covers ordering under stagger, duplicate storms, waitlist caps,
crash safety mid-burst, expiry grace periods, comped board seats, and concurrent
promotions competing for the same spot.

## Deploying

[docs/DEPLOY.md](docs/DEPLOY.md) has the full runbook for Vercel, Neon, Resend,
Google OAuth, R2 CORS, cron, and the one-time `board:bootstrap` script.
Bootstrap exists because the admin is gated on a table that only the admin can
write to.

Two things to watch. The database needs to sit in the same region as the
functions, so Neon goes in AWS us-east-1 to match the `iad1` the claim route is
pinned to. And Vercel Hobby allows only one cron run per day, where a `*/15`
schedule in `vercel.json` fails the build outright, so
`.github/workflows/cron.yml` runs the real cadence instead.

## Before changing anything

[CLAUDE.md](CLAUDE.md) lists the invariants. It covers what the claim statement
must not grow, the lock ordering every write follows, how board seats are shaped
and why, and which columns are load-bearing. The comments in
`src/lib/claims/claim.ts` and `src/lib/promotion.ts` are long because both are
easy to simplify into a bug.
