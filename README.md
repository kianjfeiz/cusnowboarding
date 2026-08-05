# CU Snowboarding

Trip signups and payments for the CU Boulder snowboarding club, live at
[cusnowboarding.com](https://cusnowboarding.com).

Replaces the Google Form that opens at 8pm on a Tuesday, the first-25-names
scramble, and the weeks of DMing people for money.

Next.js 15 (App Router) and TypeScript, Postgres via Drizzle, Auth.js with
Google sign-in, deployed on Vercel with Neon. Photos live in Cloudflare R2 and
mail goes through Resend; both are optional in development.

---

## The drop

The whole product is one moment: signups open, a hundred people hit the button,
and 25 spots are allocated in an order nobody can argue with.

**Ordering is decided inside Postgres, not in the browser.** A single statement
increments a counter on the trip row; the row lock on that `UPDATE` is what
serialises claimers, and the value each one receives is its arrival position.
Capacity is then arithmetic: `n <= capacity` wins spot `n`, anything higher
lands at waitlist position `n - capacity`.

That statement is [`src/lib/claims/claim.ts`](src/lib/claims/claim.ts), and its
comment is required reading before touching it. The obvious-looking
`where (select count(*) ...) < capacity` check is **wrong** - it reads a
snapshot and oversells under concurrency.
[`tests/isolation.test.ts`](tests/isolation.test.ts) demonstrates that failure
on purpose so it cannot quietly come back.

Members enter by typing a phrase the board sets on the trip, not by clicking a
button - a button rewards whatever clicks fastest, which is a script. Matching
ignores case and spacing. Everything slow happens earlier: signing in issues a
180-day signed cookie, and the claim route verifies it in process and goes
straight to the statement. There is deliberately no sign-in-at-drop-time path.

**Nobody is told anything until the board says so.** Entrants see "entry
received" while the board curates the roster, then one **Send results** button
closes signups, publishes outcomes, resets every payment deadline, and opens the
attendee list - all in one transaction. Members never see a waitlist number: the
board picks from the waitlist rather than working down it.

Board members ride free and off-capacity. Capacity 25 means 25 paying riders
plus however many of the board are coming.

---

## Money is not handled here

The club bills through CU's Fusion club-sports portal, as the school requires.
Fusion has **no public API**, so this app cannot observe payment and does not
pretend to.

- **Fusion owns the money.** Members are sent there by a link
  (`trips.payment_url`, falling back to `NEXT_PUBLIC_PAYMENT_URL`).
- **This app owns the roster and the deadline.** `signups.status = 'paid'`
  records the treasurer reconciling a payment, not one being observed.

That gap is real and the UI says so - paying and being marked paid are separate
events, minutes or days apart. Do not build for a webhook; there isn't one.

---

## Local development

Requires Node 22+ and Docker.

```bash
npm install
cp .env.example .env.local     # then fill in the generated-secret fields
npm run db:up                  # postgres on 55432, pgbouncer on 6432
npm run db:migrate
npm run db:seed
npm run dev
```

Generate secrets with `openssl rand -base64 32`. With no `RESEND_API_KEY`, all
mail is printed to the server log instead of sent, so the full flow works
offline. The seed creates two trips, 200 verified members, the board roles and
one superadmin, and refuses to run against a non-local database.

Sign-in is Google only, in every environment. There is no local bypass on
purpose: a second route to a session is a second route to get wrong.

**The app always talks to PgBouncer in transaction mode**, matching Neon in
production; migrations and seeding use the direct connection. Testing through
the pooler is the only way to prove the claim statement is safe there.

---

## Tests

```bash
npm test                                    # everything
npm run test:race                           # the concurrency suite
RACE_ITERATIONS=200 npm run test:race       # full soak before a real drop
```

The race suite fires 100 pre-warmed connections through PgBouncer at a
capacity-25 trip and asserts exactly 25 held with spot numbers `1..25`, 75
waitlisted with contiguous positions, a gapless total ordering, and no
duplicates. It runs 25 iterations by default, because a single green run of a
race test proves nothing.

Also covered: ordering under stagger, duplicate storms, waitlist caps, crash
safety mid-burst, expiry grace periods, comped board seats, and concurrent
promotions competing for one spot.

---

## Deploying

[`docs/DEPLOY.md`](docs/DEPLOY.md) is the full runbook - Vercel, Neon, Resend,
Google OAuth, R2 CORS, cron, and the one-time `board:bootstrap` that breaks the
chicken-and-egg of an admin gated on a table only the admin can write to.

Two things that bite:

- **The database must sit next to the functions.** The claim route pins
  `preferredRegion = "iad1"`, so Neon belongs in AWS `us-east-1`.
- **Vercel Hobby caps crons at once per day**, and a `*/15` schedule in
  `vercel.json` is a hard build failure. `.github/workflows/cron.yml` provides
  the real cadence instead.

---

## Before changing anything

[`CLAUDE.md`](CLAUDE.md) holds the invariants - what the claim statement may
never grow, the lock ordering every write follows, why board seats are shaped
the way they are, and which columns are load-bearing. The comments in
`src/lib/claims/claim.ts` and `src/lib/promotion.ts` are long for the same
reason: both are easy to "simplify" into a bug.
