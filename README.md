# CU Snowboarding

Trip signups and payments for the CU Boulder snowboarding team.

Replaces the Google Form that opens at 8pm on a Tuesday, the first-25-names
scramble, and the weeks of DMing people for money.

---

## Money is not handled here

The club bills through CU's Fusion club-sports portal, as the school requires.
Fusion has **no public API**, so this app cannot know whether anyone has paid,
and it does not pretend to.

The split:

- **Fusion owns the money.** Members are sent there by a link
  (`trips.payment_url`, falling back to `NEXT_PUBLIC_PAYMENT_URL`).
- **This app owns the roster and the deadline.** `signups.status = 'paid'` is a
  record of the treasurer reconciling a payment, not of one being observed.

That gap is real and the UI says so: paying and being marked paid are separate
events, minutes or days apart. Members are told that explicitly, because
otherwise they pay on Fusion, see a balance here an hour later, and assume the
money vanished.

If Fusion ever exposes a report export, reconciliation becomes a CSV import
against member email - the same shape as the existing dues import. Do not build
for a webhook; there isn't one.

---

## How the drop works

The whole product is one moment: signups open, a hundred people hit the button,
and 25 spots get allocated in an order nobody can argue with.

**Ordering is decided inside Postgres, not in the browser.** A single statement
increments a counter on the trip row; the row lock on that `UPDATE` is what
serialises claimers, and the value each one receives is its arrival position.
Capacity is then pure arithmetic: `n <= capacity` wins spot `n`, anything higher
lands at waitlist position `n - capacity`.

That statement is in [`src/lib/claims/claim.ts`](src/lib/claims/claim.ts). Read
the comment before changing it. In particular, the obvious-looking
`where (select count(*) ...) < capacity` capacity check is **wrong** - it reads a
snapshot and oversells under concurrency.
[`tests/isolation.test.ts`](tests/isolation.test.ts) demonstrates it overselling
on purpose so the mistake cannot quietly reappear.

**Honest limit:** "server-ordered" means ordered by when a request reaches the
server. Network jitter between someone's phone and Vercel is 20-200ms and
nothing removes it. What is guaranteed is that no client clock, retry loop, or
script can jump the queue, and that ties break deterministically in Postgres.
Say that out loud to the team - it is a much stronger claim than a Google Form
could make.

### Typing, not clicking

At open time a random five-word phrase appears above an input. Typing it
auto-submits. A plain button rewards whatever clicks fastest, which is a
script; a phrase makes the race a human one.

The phrase is signed and bound to that member and that trip, so it cannot be
pre-generated, replayed against another drop, or handed to someone else. It is
issued when the page renders, so entering still costs one HMAC check and no
extra round trip. Blocking paste is a speed bump, not a control - the signature
and the one-spot-per-member index are what actually hold.

### Why entering is instant

All the friction happens earlier. Signing in issues a 180-day signed cookie; at
drop time the handler verifies it in process (~0.1ms, no database, no Redis) and
goes straight to the claim statement. There is deliberately **no**
sign-in-at-drop-time path, which would create a two-speed race.

### Nobody is told anything until the board says so

Entrants see "entry received" and nothing more. The board then spends fifteen or
twenty minutes curating the waitlist in the roster editor before hitting **Send
results**.

Releasing results also **resets every payment deadline**. The window has to
start when the member can actually act on it - otherwise a board releasing late
would be running down a clock against people who had not been told they had a
spot. The expiry and reminder jobs both skip unreleased trips for the same
reason.

Members never see a waitlist number. The board picks from the waitlist rather
than working strictly down it, so a position would promise a queue that is not
how the decision gets made.

### The two numbers

- `trips.claim_counter` assigns **order**. It may contain gaps by design.
- `signups.spot_number` tracks **occupancy**.

Anything that reports how full a trip is must count rows, never the counter.
Holds past their payment deadline are treated as expired on read, so the numbers
stay right even if the release cron has not fired.

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

Generate the secrets with `openssl rand -base64 32`. With no `RESEND_API_KEY`,
verification codes and all other mail are printed to the server log rather than
sent, so the full flow works offline.

The seed creates two trips (one open, one scheduled), 200 verified members, the
seven board roles, and one superadmin board user.

**The app always talks to PgBouncer in transaction mode**, matching Neon in
production. Migrations and seeding use the direct connection. Testing through
the pooler is the only way to prove the claim statement is safe there.

Postgres is published on 55432 rather than 5432 to avoid colliding with a
natively installed Postgres.

---

## Trip photos (Cloudflare R2)

Photos are optional. With no bucket configured the galleries show a "not set up
yet" notice and everything else works, so this can wait until someone actually
wants to post pictures.

The bucket is **private and stays private**. Nothing in the app ever returns a
public object URL: a trip's photos are visible only to people who were on that
trip plus the board, and a permanent public URL cannot express that rule. Every
read is a fresh 15-minute signature minted after the caller is checked against
the roster.

Set up, in the Cloudflare dashboard:

1. **R2 → Create bucket.** Any name. Leave public access **off**, and do not
   enable the `r2.dev` public URL.
2. **R2 → Manage API tokens → Create token**, with *Object Read & Write*
   scoped to that bucket. It shows the access key id and secret once.
3. Copy the **Account ID** from the R2 overview page.
4. Fill these into `.env.local`:

   ```
   R2_ACCOUNT_ID=
   R2_ACCESS_KEY_ID=
   R2_SECRET_ACCESS_KEY=
   R2_BUCKET=
   ```

5. **Set the bucket's CORS policy.** The browser PUTs the file straight to R2 -
   the bytes never pass through the Next.js server, because a serverless request
   body is capped well below a modern phone photo. That upload is cross-origin,
   so without CORS every upload fails while everything else looks fine:

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3000", "https://YOUR-DOMAIN"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Reading needs no CORS rule: galleries render signed URLs in `<img src>`,
   which the browser does not treat as a cross-origin fetch.

Then verify the whole round trip:

```bash
npm run storage:check
```

It presigns an upload, PUTs a small object, heads it, reads it back through a
signed URL, checks the bucket refuses the *unsigned* URL, and deletes it. It
cannot test CORS - it is not a browser, so R2 never applies a CORS rule to it. A
green run here plus a failing upload in the app means step 5 is missing.

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
duplicates. It runs 25 iterations by default because a single green run of a
race test proves nothing.

Also covered: ordering fidelity under stagger, duplicate storms, waitlist cap
enforcement, crash safety mid-burst, expiry grace periods, and concurrent
waitlist promotions competing for one spot.

---

## Deployment notes

- **Region co-location is not optional.** The claim route pins
  `preferredRegion = "iad1"`; the database must be in the same region. A
  cross-region function pays its round trip *while holding the trip row lock*,
  which turns a 100-person burst into a multi-second tail.
- **Vercel Hobby caps crons at once per day**, which is not enough for the
  15-minute hold-expiry job. Use Pro, or trigger `/api/cron/*` from an external
  scheduler. All cron routes require `Authorization: Bearer $CRON_SECRET`.
- Ping `/api/warm` a minute or two before a drop so the function and its
  database connection are hot.
- Configure Upstash before a real drop. Without it, rate limiting falls back to
  an in-process limiter that does not hold across serverless instances.
- Go live on a low-stakes day trip first, not the season's marquee weekend.
  Run `RACE_ITERATIONS=200` against a preview deployment backed by a Neon branch
  of production first - local Postgres over loopback is ~0.1ms RTT, real
  Vercel-to-Neon is 1-3ms, and only the deployed test shows the true tail.

---

## Not in V1

Member accounts and portal, board task tracking for the seven roles, merch
orders, gear rental, carpools, rooming, refund self-service, SMS.

The schema leaves room for all of it - `members` is a real entity,
`board_roles` / `board_user_roles` already model the seven roles with term
years, and `audit_events` is generic - but none of it is built.
