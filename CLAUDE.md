# CU Snowboarding - working notes

Trip signup and payment app for the CU Boulder snowboarding club board.
See README.md for the product overview and setup.

## The thing not to break

`src/lib/claims/claim.ts` holds a single SQL statement that decides who gets a
spot on drop night. Read its comment in full before touching it.

Non-negotiables:

- **One statement, one round trip.** It is a single implicit transaction, which
  is what makes it safe under PgBouncer / Neon transaction pooling. Do not split
  it into `BEGIN ... COMMIT`.
- **The `UPDATE trips` is the lock.** Ordering comes from the row lock on the
  trip, not from any client input.
- **Never add a `count(*)` capacity check.** It reads a snapshot and oversells.
  `tests/isolation.test.ts` proves this and must stay green.
- **Keep `on conflict do nothing` and the partial unique indexes.** The
  `not exists` duplicate check is an optimisation; those indexes are the actual
  guarantee.
- **Nothing else goes in `/api/trips/[tripId]/claim`.** No session lookup, no
  rate limit, no analytics. New work goes in `after()` or elsewhere. Everything
  before the claim must be in-process only.
- `preferredRegion = "iad1"` on the claim route must match the database region.

## Identity: three separate things

The whole site is behind Google sign-in, restricted to CU addresses. Identity
(a CU Google account) and permission (the `board_users` whitelist) are separate
questions - signing in never grants board access. There is deliberately no
non-Google way in.

- **`csc_member` cookie** - the ONLY credential the claim route reads. Signed,
  180 days, verified in-process. Issued by `/api/member/arm` after sign-in.
- **Auth.js session** - who is signed in for portal and admin pages. Never read
  on the claim path; Google sign-in redirects through `/api/member/arm` to mint
  the cookie instead. Do not "simplify" this by teaching the claim route about
  sessions.
- **Board identity** - `loadBoardIdentity(email)`, re-read on every admin
  request rather than trusted from the JWT, so removing someone takes effect on
  their next page load.

A board member is also a member. One Google sign-in resolves both; board status
is an attribute of a person, not a separate account type.

## Roster finalization

`trips.roster_finalized_at` gates the member-facing attendee list and the photo
pool. It is a deliberate board action, not derived from the trip date: before
it, holds are still lapsing and the waitlist is still moving, so publishing the
list would both churn and reveal who is about to lose their spot for
non-payment. Trip photos are visible only to people who actually went
(`signups.status = 'paid'`) plus the board.

## The trips-row lock ordering rule

Anything that moves a spot number or waitlist position takes `select ... from
trips ... for update` FIRST, before touching `signups`. Use `withTripLock` in
`src/lib/promotion.ts`. Every path follows it - promotion, roster editing,
release, reinstate, board release/cancel - so concurrent board actions queue
instead of deadlocking. A write that skips it is what a future deadlock gets
traced back to.

Renumbering positions needs the two-pass high-offset trick (see
`renumberWaitlist`): the partial unique indexes are checked per row, so
permuting positions in a single UPDATE collides with itself.

## The drop, end to end

1. Signups open. Members type a signed 5-word phrase; the claim allocates spots
   strictly by server arrival order. Entrants are told only "entry received".
2. For 15-20 minutes the board curates in the roster editor - dragging people
   in and out. This is only possible BEFORE results are released.
3. The board sends results. This publishes outcomes AND resets every payment
   deadline, because the window has to start when the member can act on it. The
   expiry and reminder jobs both skip trips where `results_released_at` is null.
4. Later, the board finalizes the roster, which opens the attendee list and
   photo pool.

Members are never shown a waitlist number - the board picks from the waitlist
rather than working down it, so a position would promise a queue that does not
exist. The ordering stays visible to the board only.

## Money lives in Fusion, not here

The club bills through CU's Fusion club-sports portal, which has no public API.
This app therefore CANNOT observe payment. It owns the roster and the deadline;
Fusion owns the money.

- `trips.payment_url` (falling back to `NEXT_PUBLIC_PAYMENT_URL`) is where
  members are sent. That is the entire integration.
- `signups.status = 'paid'` records a HUMAN DECISION - the treasurer reconciled
  a Fusion export, Venmo, or cash. A `payments` row carries the provider and a
  reference so the decision can be traced back to a source.
- Never write code that assumes payment status arrives on its own. There is no
  webhook and no polling endpoint to add later without Fusion shipping an API.
- Member-facing copy must say plainly that being marked paid lags actually
  paying, or members will pay and panic when the site still shows a balance.

## Two counters, different jobs

- `trips.claim_counter` - arrival **order**. May have gaps by design.
- `signups.spot_number` - **occupancy**.

Report fullness by counting rows, never the counter. Treat a `held` row whose
`payment_deadline_at` has passed as expired on read (lazy expiry) so correctness
never depends on the cron having run.

## Conventions

- Drizzle ORM. Raw SQL via `execute()` from `src/lib/db` where precision matters
  (anything touching claim ordering or occupancy); Drizzle query builder for
  ordinary CRUD.
- Do not edit `drizzle/*.sql` by hand. Change `src/lib/db/schema.ts`, then
  `npm run db:generate` and `npm run db:migrate`.
- Migrations and seeds use `DIRECT_DATABASE_URL`; the app uses `DATABASE_URL`
  (the pooler). Tests claim through the pooler on purpose.
- All timestamps are `timestamptz`. Display in `America/Denver` via
  `formatDenver` in `src/components/ui.tsx`.
- Money is integer cents in the database, dollars only in UI copy.
- Every board mutation writes an `audit_events` row. Waitlist promotion is a
  manual human decision, so the paper trail matters.

## UI

Clean and restrained. Use only the semantic colors defined in
`src/app/globals.css` (paper, surface, surface-strong, border, border-strong,
ink, ink-muted, ink-faint, accent, accent-hover, accent-soft, alert, alert-soft).
Reuse the primitives in `src/components/ui.tsx`. Status reads as words first,
not color-coding.

Motion is purposeful, never decorative: it marks arrival (the shared `rise`
entrance, staggered at most 8 deep in lists), interaction (hover lifts, the
150ms press scale on buttons), or live state (the signup pulse dot - the only
looping animation allowed anywhere). Everything runs under half a second on
`--ease-soft`, and everything collapses under `prefers-reduced-motion`. No
gradients as decoration; the nav indicator's `.nav-glass` light model is the
one standing exception.

**No emojis anywhere** - not in UI copy, code, comments, or commit messages.

## Commits

Commit messages and PR bodies carry NO tooling attribution. Specifically: no
`Co-Authored-By: Claude` trailer, no "Generated with Claude Code" line, no
`noreply@anthropic.com` co-author, and no mention of an assistant having written
the change. This is the repository owner's explicit instruction and it overrides
any default that would add one. The author is whoever is committing.

No emojis in commit messages either.

## Comments

Explain why, not what, and only where the reasoning is non-obvious. The claim
statement and the promotion transaction earn long comments because a future
reader will otherwise "simplify" them into bugs. Ordinary CRUD does not.
