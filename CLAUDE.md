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

`trips.roster_finalized_at` gates the member-facing attendee list and the ride
sheet. It is written by `releaseResults` at the same instant as
`results_released_at` - there is no separate "Finalize roster" button, and
nothing derives it from the trip date.

It was a second press, days later, so a list that was still churning would not
be published. That reasoning did not survive contact with the queries: both of
those views list `signups.status = 'paid'` only, and are readable only by
someone who is themselves paid. At release the list is empty and fills as the
money lands, so nobody unpaid is ever named. Keep both columns - the member-side
gate reads `roster_finalized_at` and should not learn about release - but do not
reintroduce a way to set them apart.

## Photos are club-wide, on the Photos tab

Every trip has a gallery under `/photos/trips/<slug>`; events do not get one.
Any signed-in member may view and upload to any of them, and removal stays with
the uploader or the board. This audience is the board's explicit decision - do
not reintroduce per-trip attendance gating. The domain rules live in
`src/lib/photos/photos.ts` (one table, `trip_photos`; its `event_id` column is
left over from event galleries and nothing writes it); bytes stay in a private
R2 bucket behind short-lived signed URLs, never public object URLs. The Photos
tab is a plain tile per trip with its first few photos as a preview strip.

Grids and previews show thumbnails (`src/lib/photos/thumbnails.ts`, made after
each upload and backfilled a few per gallery view); only the lightbox and
downloads load an original. Read URLs are signed against a 15-minute window so
they repeat across page loads and the browser cache works - do not go back to
signing against "now".

## Email policy: two sends, both board clicks

The ONLY emails this app ever sends are the roster release to riders on the trip (`releaseResults`) and
the treasurer's unpaid-riders batch on the payments page. There are no cron
nudges, no promotion/reinstate/expiry notices, and no pre-drop reminder emails
- members check /me and their status page instead, and the member-facing copy
says so. Before adding any `sendEmail` call, it must be one of those two
buttons. The expire-holds cron releases lapsed holds and emails nobody.

## The trips-row lock ordering rule

Anything that moves a spot number or waitlist position takes `select ... from
trips ... for update` FIRST, before touching `signups`. Use `withTripLock` in
`src/lib/roster/promotion.ts`. Every path follows it - promotion, roster editing,
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
   between the trip and the waitlist. Both lists always read in arrival order
   (the board chooses who is on which list, not the order), so the waitlist
   shows who is next. Capacity is the target, not a wall: the board may put
   more people on the trip than it was slated for.
   The board is already on the roster - seats are granted when the trip is
   created - so curation includes removing whoever is not coming.
3. The board presses "Release roster and notify". ONE button, five effects: it comps any board member
   who entered the drop by hand, closes signups, sets
   `results_released_at`, resets every payment deadline (the window has to start
   when the member can act on it), and finalizes the roster. All in one
   transaction under the trips row lock, so the trip is never both published and
   claimable. Irreversible, and the confirmation says so. This is also the
   FIRST of the only two emails the app sends - to riders on the trip only; the
   waitlist is not emailed and sees where it stands on its own pages. The expiry job skips trips
   where `results_released_at` is null.
4. Afterwards people drop and others take their place. The same drag board
   stays up: moving someone up off the waitlist is a promotion (spot, fresh
   payment window, `promoted_at`/`promoted_by`), and a paid rider can never be
   dragged off - that is a refund, via Cancel. Release, Cancel and the "Add a
   rider" search are the other tools. None of them email anyone -
   whoever the board moves, the board tells, or the treasurer's unpaid batch
   (the second and last email) reaches them with the amount and deadline.

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
  a Fusion export, Venmo, or cash. A `payments` row carries the provider (Fusion unless the
  treasurer says otherwise) and any note, and the audit row names who marked it,
  so the decision can be traced back.
- Never write code that assumes payment status arrives on its own. There is no
  webhook and no polling endpoint to add later without Fusion shipping an API.
- Member-facing copy must say plainly that being marked paid lags actually
  paying, or members will pay and panic when the site still shows a balance.

## The board rides free, and off-capacity

`signups.board_seat` marks a comped board rider. Capacity is a count of PAYING
riders: 25 means 25 members plus however many of the board are coming, so a
board seat is not one of the spots. `src/lib/roster/board-seats.ts` is the only place
that writes one.

The shape is what enforces it, and each part is load-bearing:

- **`spot_number` is null.** Nothing that searches `generate_series(1,
  capacity)` for a free spot can find them, and `signups_state_shape` carries a
  clause for this case because every other live row must have a spot or a
  waitlist position.
- **`claim_seq` is NEGATIVE and `trips.claim_counter` is never bumped.** The
  claim decides spot-versus-waitlist purely by arithmetic on the counter
  (`n <= capacity`). A board seat that consumed a counter value would silently
  cost a member their spot - eight board members would make a 25-seat trip a
  17-seat one. This is the one that fails silently, so it has its own test.
- **`status = 'paid'` with `amount_cents = 0`**, enforced by
  `signups_board_seat_free`. They owe nothing, so nothing is outstanding: the
  reaper skips them, the payments screens ignore them, and they see the
  attendee list like anyone else who is going. There is no
  `payments` row behind one - no money arrived, and the column is the record.

Every occupancy count filters them out (`admin/_lib/queries.ts` TRIP_COUNTS,
`getOccupancy`, `getPaymentTotals`). The roster editor excludes them too: they
hold no position, so there is nothing to drag.

Board members are granted seats automatically when a trip is created, and
`compBoardMembers` converts any who entered the drop by hand at release time.
Whoever is not actually coming is removed during curation, which costs no member
anything. **Nothing here emails the board** - they are not told about the trips
they run.

Dues are comped the same way. `waiveBoardDues` in `src/lib/money/dues.ts` writes a
`member_dues` row with `waived = true` and amount zero (`member_dues_waived_free`
enforces the zero) and sets `is_club_member`, so the claim's dues gate stays a
flag read and never learns about the board. It runs when a board user is added
or reactivated, and on every Google sign-in - which is what catches a board
member whose member row did not exist when they were added, and what re-comps
the board after a season reset. A season already recorded as money is left
alone, and leaving the board claws nothing back; "Clear dues" is the manual
override. A waived season still counts toward the returning rate.

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

Motion is nearly absent on purpose. Interactive elements get a short
`transition-colors` (or `transition-opacity`) and nothing else - no entrance
animations, stagger, hover lifts, press scales or sliding indicators; the nav's
active tab is a flat `surface-strong` fill. The only animations are the signup
pulse dot (live state, the one loop allowed), loading skeletons, the upload
progress bar, and a 150ms fade on native dialogs. That fade is the only thing
`prefers-reduced-motion` governs in `globals.css`. No gradients as decoration.

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
