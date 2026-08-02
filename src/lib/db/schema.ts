import { sql, relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Emails are compared case-insensitively everywhere. Doing it in the column
 * type rather than by lowercasing in application code means a stray
 * `Jane@Colorado.edu` cannot create a second member row that slips past the
 * one-signup-per-member index.
 */
const citext = customType<{ data: string }>({ dataType: () => "citext" });
const inet = customType<{ data: string }>({ dataType: () => "inet" });

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const tripStatus = pgEnum("trip_status", [
  "draft",
  "scheduled",
  "open",
  "closed",
  "cancelled",
  "completed",
]);

export const signupStatus = pgEnum("signup_status", [
  "held", // has a spot, payment pending
  "paid", // confirmed, on the trip
  "waitlisted", // overflow, ordered by claim_seq
  "expired", // hold lapsed, spot released
  "cancelled",
  "refunded",
]);

export const paymentStatus = pgEnum("payment_status", [
  "open",
  "paid",
  "expired",
  "failed",
  "refunded",
]);
// 'open', 'expired' and 'failed' are vestigial - they described a checkout
// session this app no longer creates. Recorded payments are 'paid' or
// 'refunded'. Left in place because dropping enum values needs a table rewrite
// for no benefit.

export const photoStatus = pgEnum("photo_status", [
  "processing",
  "ready",
  /** Hidden from galleries but kept, so a removal can be reviewed or undone. */
  "removed",
]);

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export const boardUsers = pgTable("board_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email").notNull().unique(),
  name: text("name"),
  imageUrl: text("image_url"),
  isActive: boolean("is_active").notNull().default(true),
  /** Can add and remove board members. Held by the president. */
  isSuperadmin: boolean("is_superadmin").notNull().default(false),
  lastLoginAt: timestamptz("last_login_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

/**
 * Roles are rows, not an enum column on board_users. One person can hold two
 * roles, and the assignment is scoped to a term year so the record survives
 * turnover. This is the seam the later board-task phase hangs off.
 */
export const boardRoles = pgTable("board_roles", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const boardUserRoles = pgTable(
  "board_user_roles",
  {
    boardUserId: uuid("board_user_id")
      .notNull()
      .references(() => boardUsers.id, { onDelete: "cascade" }),
    roleKey: text("role_key")
      .notNull()
      .references(() => boardRoles.key),
    /** 2026 means academic year 2026-27. */
    termYear: integer("term_year").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.boardUserId, t.roleKey, t.termYear] }),
    index("board_user_roles_role_idx").on(t.roleKey, t.termYear),
  ],
);

// ---------------------------------------------------------------------------
// Members - no accounts, no passwords in V1
// ---------------------------------------------------------------------------

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: citext("email").notNull().unique(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    /** Null means unverified, which means they cannot claim a spot. */
    emailVerifiedAt: timestamptz("email_verified_at"),
    /** Dues paid. Imported by the treasurer from the club roster. */
    isClubMember: boolean("is_club_member").notNull().default(false),
    isBlocked: boolean("is_blocked").notNull().default(false),
    /** Bumping this invalidates every csc_member cookie issued to this member. */
    tokenVersion: integer("token_version").notNull().default(1),

    /**
     * Google's stable subject id. Kept alongside email rather than instead of
     * it, because a member may sign in with Google on one device and verify by
     * emailed code on another, and both must resolve to the same person.
     */
    googleSub: text("google_sub").unique(),
    imageUrl: text("image_url"),
    lastLoginAt: timestamptz("last_login_at"),

    notes: text("notes"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("members_verified_idx")
      .on(t.emailVerifiedAt)
      .where(sql`email_verified_at is not null`),
  ],
);

/**
 * One row per member per season that they paid dues for.
 *
 * `members.is_club_member` stays the fast flag for THIS season - it is what the
 * claim statement reads, and that path must not grow a join. This table is the
 * history behind it, and it exists for one reason: dues are cheaper for someone
 * who paid in a previous year, so "have they ever paid before" has to be a fact
 * the system holds rather than something the treasurer remembers.
 *
 * Recording dues writes here AND sets the flag; a new season starts with the
 * flag cleared and the history intact.
 */
export const memberDues = pgTable(
  "member_dues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    /** 2026 means the 2026-27 season, matching board_user_roles.term_year. */
    termYear: integer("term_year").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** fusion | venmo | cash | check | other */
    provider: text("provider").notNull().default("fusion"),
    reference: text("reference"),
    note: text("note"),
    recordedBy: uuid("recorded_by").references(() => boardUsers.id),
    paidAt: timestamptz("paid_at").notNull().defaultNow(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    /** Dues are paid once a season. Recording twice is a mistake, not a top-up. */
    uniqueIndex("member_dues_one_per_season").on(t.memberId, t.termYear),
    index("member_dues_member_idx").on(t.memberId, t.termYear.desc()),
    check("member_dues_amount_nonneg", sql`${t.amountCents} >= 0`),
  ],
);

export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: citext("email").notNull(),
    /** sha256(code + VERIFY_PEPPER). The plaintext code is never stored. */
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    consumedAt: timestamptz("consumed_at"),
    attempts: integer("attempts").notNull().default(0),
    ip: inet("ip"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("email_verifications_lookup")
      .on(t.email, t.createdAt.desc())
      .where(sql`consumed_at is null`),
  ],
);

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    resort: text("resort"),
    departAt: timestamptz("depart_at").notNull(),
    returnAt: timestamptz("return_at"),
    description: text("description"),
    priceCents: integer("price_cents").notNull(),
    capacity: integer("capacity").notNull(),
    /** Null means an unbounded waitlist. */
    waitlistCap: integer("waitlist_cap"),
    signupOpensAt: timestamptz("signup_opens_at").notNull(),
    signupClosesAt: timestamptz("signup_closes_at"),
    /** How long a won spot is held before the payment deadline lapses. */
    paymentWindowHours: integer("payment_window_hours").notNull().default(48),
    requiresDues: boolean("requires_dues").notNull().default(true),
    status: tripStatus("status").notNull().default("draft"),

    /**
     * Where members are sent to pay - the club's Fusion portal link for this
     * trip. Payment happens entirely outside this app, so this is the handoff
     * point. Null falls back to the club-wide NEXT_PUBLIC_PAYMENT_URL.
     */
    paymentUrl: text("payment_url"),


    /**
     * Set when the board publishes outcomes to members.
     *
     * Until this is set, an entrant is told only that their entry was received.
     * Revealing spot-or-waitlist the instant someone stops typing turns the
     * drop into a live scoreboard: everyone who missed reloads, re-enters, and
     * messages the board within seconds.
     *
     * Releasing RESETS the payment deadline on every held signup, because the
     * window has to start when the member can actually act on it. Without that,
     * a board that released two days late would reap spots from people who were
     * never told they had one. The expiry and reminder jobs both skip trips
     * where this is null for the same reason.
     */
    resultsReleasedAt: timestamptz("results_released_at"),
    resultsReleasedBy: uuid("results_released_by").references(() => boardUsers.id),

    /**
     * Set when the board declares the roster settled. A later, separate step
     * from releasing results: outcomes go out while holds are still being paid,
     * whereas the attendee list and photo pool should only open once the roster
     * has stopped moving. Finalizing is what opens those.
     */
    rosterFinalizedAt: timestamptz("roster_finalized_at"),
    rosterFinalizedBy: uuid("roster_finalized_by").references(() => boardUsers.id),

    /**
     * THE COUNTER. The sole source of server-side ordering for this trip.
     * Incrementing it is what takes the row lock during a claim, and the value
     * returned is the claimer's arrival position.
     *
     * This assigns ORDER. It does not track OCCUPANCY - signups.spot_number
     * does that. Keeping them decoupled is what lets a released spot be
     * re-filled by manual waitlist promotion without renumbering history.
     */
    claimCounter: bigint("claim_counter", { mode: "number" }).notNull().default(0),

    createdBy: uuid("created_by").references(() => boardUsers.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("trips_open_idx")
      .on(t.signupOpensAt)
      .where(sql`status in ('scheduled','open')`),
    check("trips_price_nonneg", sql`${t.priceCents} >= 0`),
    check("trips_capacity_positive", sql`${t.capacity} > 0`),
    check("trips_waitlist_cap_positive", sql`${t.waitlistCap} is null or ${t.waitlistCap} > 0`),
    check(
      "trips_payment_window_sane",
      sql`${t.paymentWindowHours} between 1 and 336`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Signups - the important one
// ---------------------------------------------------------------------------

export const signups = pgTable(
  "signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),

    /** Server arrival order, issued under the trip row lock. Never reused. */
    claimSeq: bigint("claim_seq", { mode: "number" }).notNull(),
    status: signupStatus("status").notNull(),
    /** 1..capacity while holding a spot, null once released. */
    spotNumber: integer("spot_number"),
    /** 1..n while waitlisted, null while holding a spot. */
    waitlistPosition: integer("waitlist_position"),

    /** Server clock at the moment the lock was acquired. */
    claimedAt: timestamptz("claimed_at").notNull().defaultNow(),
    paymentDeadlineAt: timestamptz("payment_deadline_at"),
    paidAt: timestamptz("paid_at"),
    releasedAt: timestamptz("released_at"),
    /** 'expired' | 'board_cancel' | 'member_cancel' | 'refund' */
    releaseReason: text("release_reason"),
    promotedAt: timestamptz("promoted_at"),
    promotedBy: uuid("promoted_by").references(() => boardUsers.id),

    /** Unguessable handle for the member's /pay and /signup pages. */
    payToken: text("pay_token").notNull().unique(),
    /** Snapshot of the trip price at claim time, so later edits cannot change what is owed. */
    amountCents: integer("amount_cents").notNull(),
    /** Treasurer accepted Venmo, cash, or a school-mandated method instead. */
    paidOffline: boolean("paid_offline").notNull().default(false),
    offlineNote: text("offline_note"),

    createdByBoardUserId: uuid("created_by_board_user_id").references(() => boardUsers.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // === Correctness backstop ===
    // These four indexes make the bad states physically unrepresentable. The
    // claim statement is written so it never relies on them, but if it were
    // ever wrong, Postgres rejects the write rather than overselling a trip.

    /** One active signup per member per trip. Partial, so a cancelled member can retry. */
    uniqueIndex("signups_one_active_per_member")
      .on(t.tripId, t.memberId)
      .where(sql`status in ('held','paid','waitlisted')`),

    /** Overselling is impossible: two rows cannot share a spot number. */
    uniqueIndex("signups_unique_spot")
      .on(t.tripId, t.spotNumber)
      .where(sql`spot_number is not null`),

    /** Arrival ordering is total within a trip. */
    uniqueIndex("signups_unique_seq").on(t.tripId, t.claimSeq),

    /** Waitlist positions are unique among live waitlisters. */
    uniqueIndex("signups_unique_waitlist_pos")
      .on(t.tripId, t.waitlistPosition)
      .where(sql`waitlist_position is not null and status = 'waitlisted'`),

    index("signups_trip_order_idx").on(t.tripId, t.claimSeq),
    index("signups_trip_status_idx").on(t.tripId, t.status),
    index("signups_expiry_idx").on(t.paymentDeadlineAt).where(sql`status = 'held'`),
    index("signups_member_idx").on(t.memberId, t.createdAt.desc()),

    // === State machine shape ===
    check(
      "signups_state_shape",
      sql`
        (${t.status} in ('held','paid')
           and ${t.spotNumber} is not null
           and ${t.waitlistPosition} is null)
        or (${t.status} = 'waitlisted'
           and ${t.spotNumber} is null
           and ${t.waitlistPosition} is not null)
        or (${t.status} in ('expired','cancelled','refunded')
           and ${t.spotNumber} is null)
      `,
    ),
    check(
      "signups_held_has_deadline",
      sql`${t.status} <> 'held' or ${t.paymentDeadlineAt} is not null`,
    ),
    check("signups_amount_nonneg", sql`${t.amountCents} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * A payment the treasurer RECORDED, not one this system processed.
 *
 * The club bills through CU's Fusion club-sports portal, which has no public
 * API, so nothing here can observe money moving. Every row is written by a
 * human who reconciled a Fusion export, a Venmo notification, or cash in hand.
 * `reference` is what ties it back to that source.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signupId: uuid("signup_id")
      .notNull()
      .references(() => signups.id, { onDelete: "cascade" }),
    /** fusion | venmo | cash | check | other */
    provider: text("provider").notNull().default("fusion"),
    /** Fusion transaction id, Venmo note, or whatever makes this findable again. */
    reference: text("reference"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    status: paymentStatus("status").notNull().default("paid"),
    paidAt: timestamptz("paid_at"),
    refundedAt: timestamptz("refunded_at"),
    refundedCents: integer("refunded_cents").notNull().default(0),
    /** Free-text detail from whoever recorded it. */
    note: text("note"),
    recordedBy: uuid("recorded_by").references(() => boardUsers.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("payments_signup_idx").on(t.signupId, t.createdAt.desc())],
);

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export const eventStatus = pgEnum("event_status", [
  "draft",
  "published",
  "cancelled",
]);

export const eventKind = pgEnum("event_kind", [
  "party",
  "meeting",
  "social",
  "fundraiser",
  "other",
]);

/**
 * Club events - parties, meetings, socials. Separate from `trips` on purpose:
 * a trip has capacity, an ordered claim race, money, and a roster, and none of
 * that applies to a party. Folding them together would mean every trip query
 * growing a "but not events" clause, including the claim.
 *
 * The calendar shows both, joined at the read layer.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    kind: eventKind("kind").notNull().default("social"),
    description: text("description"),

    locationName: text("location_name"),
    address: text("address"),
    /** Free-form so the board can paste a Maps or Apple Maps link. */
    mapUrl: text("map_url"),

    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at"),
    /** All-day events have no meaningful clock time to render. */
    allDay: boolean("all_day").notNull().default(false),

    status: eventStatus("status").notNull().default("draft"),
    /** Practical detail the board always ends up needing somewhere. */
    isTwentyOnePlus: boolean("is_twenty_one_plus").notNull().default(false),

    createdBy: uuid("created_by").references(() => boardUsers.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("events_starts_idx").on(t.startsAt),
    index("events_published_idx")
      .on(t.startsAt)
      .where(sql`status = 'published'`),
    check(
      "events_end_after_start",
      sql`${t.endsAt} is null or ${t.endsAt} >= ${t.startsAt}`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Trip photos
// ---------------------------------------------------------------------------

/**
 * Photos are visible only to members who were actually on the trip (plus the
 * board). These are identifiable pictures of students taken on a club trip, so
 * the default is the narrow audience rather than the club-wide one; widening it
 * later is a one-line policy change, un-sharing something is not.
 *
 * Only the storage key lives here. Bytes go to object storage, and the app
 * hands out short-lived signed URLs rather than making a bucket public - a
 * public bucket URL is forever and cannot be scoped to the trip roster.
 */
export const tripPhotos = pgTable(
  "trip_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    uploaderMemberId: uuid("uploader_member_id")
      .notNull()
      .references(() => members.id),

    /** Object key in the bucket. Unique so a retried upload cannot fork. */
    storageKey: text("storage_key").notNull().unique(),
    thumbnailKey: text("thumbnail_key"),
    originalFilename: text("original_filename"),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    caption: text("caption"),
    /** From EXIF where available, so a trip gallery can sort chronologically. */
    takenAt: timestamptz("taken_at"),

    status: photoStatus("status").notNull().default("processing"),
    removedByBoardUserId: uuid("removed_by_board_user_id").references(() => boardUsers.id),
    removedReason: text("removed_reason"),

    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("trip_photos_trip_idx").on(t.tripId, t.createdAt.desc()),
    index("trip_photos_uploader_idx").on(t.uploaderMemberId, t.createdAt.desc()),
    index("trip_photos_visible_idx")
      .on(t.tripId, t.takenAt.desc())
      .where(sql`status = 'ready'`),
    check("trip_photos_size_positive", sql`${t.sizeBytes} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Rides - the carpool sheet
// ---------------------------------------------------------------------------

/**
 * A member's car, offered to the trip. The digital version of the ride
 * spreadsheet: the club never drives anyone anywhere, it just gives people on
 * the same trip a place to find each other.
 *
 * Departure and return are deliberately free text. The sheet always said
 * things like "6am, campus lot" and "Sunday after lunch" - a timestamp picker
 * would add friction to say less. Nothing schedules against these values.
 */
export const rides = pgTable(
  "rides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    driverMemberId: uuid("driver_member_id")
      .notNull()
      .references(() => members.id),

    /** Passenger seats on offer; the driver is not counted. */
    seatCapacity: integer("seat_capacity").notNull(),
    /** How riders reach the driver. Typed per ride, not read from the member row. */
    phone: text("phone").notNull(),
    departsNote: text("departs_note").notNull(),
    returnsNote: text("returns_note"),

    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One car per driver per trip; offering again is editing, not adding.
    uniqueIndex("rides_one_per_driver_idx").on(t.tripId, t.driverMemberId),
    index("rides_trip_idx").on(t.tripId, t.createdAt),
    check("rides_seats_sane", sql`${t.seatCapacity} between 1 and 8`),
  ],
);

/**
 * A claimed seat. `trip_id` is denormalised from the ride so the database can
 * hold the real rule - one seat per member per TRIP, not per car - in a unique
 * index instead of trusting application code to check every car.
 */
export const rideRiders = pgTable(
  "ride_riders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rideId: uuid("ride_id")
      .notNull()
      .references(() => rides.id, { onDelete: "cascade" }),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    phone: text("phone").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ride_riders_one_seat_per_trip_idx").on(t.tripId, t.memberId),
    index("ride_riders_ride_idx").on(t.rideId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Forensics
// ---------------------------------------------------------------------------

/**
 * Every claim attempt including the losers, written off the response path so
 * it adds no latency. This is what settles "but I clicked at 8:00:00".
 */
export const claimAttempts = pgTable(
  "claim_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tripId: uuid("trip_id"),
    memberId: uuid("member_id"),
    email: citext("email"),
    /** held | waitlisted | duplicate | not_open | unverified | full | error */
    result: text("result").notNull(),
    claimSeq: bigint("claim_seq", { mode: "number" }),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("claim_attempts_trip_idx").on(t.tripId, t.createdAt)],
);

/** Waitlist promotion is a manual board decision, so it needs a paper trail. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorBoardUserId: uuid("actor_board_user_id").references(() => boardUsers.id),
    /** e.g. signup.promote, signup.release, payment.refund, trip.publish */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    data: jsonb("data"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_events_entity_idx").on(t.entityType, t.entityId, t.createdAt.desc())],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const tripsRelations = relations(trips, ({ many }) => ({
  signups: many(signups),
  photos: many(tripPhotos),
}));

export const membersRelations = relations(members, ({ many }) => ({
  signups: many(signups),
  photos: many(tripPhotos),
}));

export const tripPhotosRelations = relations(tripPhotos, ({ one }) => ({
  trip: one(trips, { fields: [tripPhotos.tripId], references: [trips.id] }),
  uploader: one(members, {
    fields: [tripPhotos.uploaderMemberId],
    references: [members.id],
  }),
}));

export const signupsRelations = relations(signups, ({ one, many }) => ({
  trip: one(trips, { fields: [signups.tripId], references: [trips.id] }),
  member: one(members, { fields: [signups.memberId], references: [members.id] }),
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  signup: one(signups, { fields: [payments.signupId], references: [signups.id] }),
}));

export const boardUsersRelations = relations(boardUsers, ({ many }) => ({
  roles: many(boardUserRoles),
}));

export const boardUserRolesRelations = relations(boardUserRoles, ({ one }) => ({
  boardUser: one(boardUsers, {
    fields: [boardUserRoles.boardUserId],
    references: [boardUsers.id],
  }),
  role: one(boardRoles, { fields: [boardUserRoles.roleKey], references: [boardRoles.key] }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;
export type Signup = typeof signups.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type BoardUser = typeof boardUsers.$inferSelect;
export type TripPhoto = typeof tripPhotos.$inferSelect;
export type ClubEvent = typeof events.$inferSelect;
export type NewClubEvent = typeof events.$inferInsert;
export type SignupStatus = (typeof signupStatus.enumValues)[number];
export type TripStatus = (typeof tripStatus.enumValues)[number];
