"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { execute } from "@/lib/db";
import type { TripStatus } from "@/lib/db/schema";
import { requireCapability } from "../_lib/actor";
import { recordAudit } from "../_lib/audit";
import { parseDenverInput } from "../_lib/datetime";
import { canTransition } from "../_lib/trip-status";
import { signupClosesAt as signupWindowEnd } from "@/lib/signup-window";

export interface TripFormState {
  error?: string;
}

// ---------------------------------------------------------------------------
// Form parsing
// ---------------------------------------------------------------------------

interface TripValues {
  title: string;
  slug: string;
  resort: string | null;
  description: string | null;
  departAt: Date;
  returnAt: Date;
  priceCents: number;
  capacity: number;
  waitlistCap: number | null;
  signupOpensAt: Date;
  signupClosesAt: Date | null;
  signupPhrase: string;
  paymentWindowHours: number;
  requiresDues: boolean;
  paymentUrl: string | null;
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

type Parsed = { ok: true; value: TripValues } | { ok: false; error: string };

function parseTripForm(formData: FormData): Parsed {
  const title = text(formData, "title");
  if (!title) return { ok: false, error: "Title is required." };

  const slug = slugify(text(formData, "slug") || title);
  if (!slug) return { ok: false, error: "Could not derive a URL slug from that title." };

  const departAt = parseDenverInput(text(formData, "departAt"));
  if (!departAt) return { ok: false, error: "Departure date and time are required." };

  const returnAt = parseDenverInput(text(formData, "returnAt"));
  if (!returnAt) return { ok: false, error: "Return date and time are required." };
  if (returnAt < departAt) {
    return { ok: false, error: "The return time is before the departure time." };
  }

  const signupOpensAt = parseDenverInput(text(formData, "signupOpensAt"));
  if (!signupOpensAt) return { ok: false, error: "Signups must have an opening time." };

  // Derived, not entered. The drop is decided in the first seconds, so a manual
  // close time was only ever another field to get wrong.
  const signupClosesAt = signupWindowEnd(signupOpensAt);

  /*
    Stored exactly as the board typed it, because it is shown back to members
    on the trip page. Matching is what ignores case and spacing, not storage -
    normalising here would quietly rewrite the board's own words.

    Rejecting a blank one matters more than it looks: an empty phrase matches
    an empty input box, so the entry form would submit itself the instant the
    page opened.
  */
  const signupPhrase = text(formData, "signupPhrase");
  if (!signupPhrase) return { ok: false, error: "A signup phrase is required." };
  if (signupPhrase.length > 80) {
    return { ok: false, error: "Keep the signup phrase under 80 characters." };
  }

  // The board thinks in dollars; the database stores cents so that no rounding
  // ever happens on the money path.
  const priceDollars = Number(text(formData, "priceDollars"));
  if (!Number.isFinite(priceDollars) || priceDollars < 0) {
    return { ok: false, error: "Price must be a number of dollars, zero or more." };
  }
  const priceCents = Math.round(priceDollars * 100);

  const capacity = Number(text(formData, "capacity"));
  if (!Number.isInteger(capacity) || capacity < 1) {
    return { ok: false, error: "Capacity must be a whole number of at least 1." };
  }

  const waitlistRaw = text(formData, "waitlistCap");
  let waitlistCap: number | null = null;
  if (waitlistRaw !== "") {
    const parsed = Number(waitlistRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return { ok: false, error: "Waitlist cap must be blank (unlimited) or at least 1." };
    }
    waitlistCap = parsed;
  }

  const paymentWindowHours = Number(text(formData, "paymentWindowHours"));
  if (!Number.isInteger(paymentWindowHours) || paymentWindowHours < 1 || paymentWindowHours > 336) {
    return { ok: false, error: "Payment window must be between 1 and 336 hours." };
  }

  return {
    ok: true,
    value: {
      title,
      slug,
      resort: text(formData, "resort") || null,
      description: text(formData, "description") || null,
      departAt,
      returnAt,
      priceCents,
      capacity,
      waitlistCap,
      signupOpensAt,
      signupClosesAt,
      signupPhrase,
      paymentWindowHours,
      requiresDues: formData.get("requiresDues") === "on",
      paymentUrl: text(formData, "paymentUrl") || null,
    },
  };
}

function isDuplicateSlug(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

/**
 * Refuses a capacity that is smaller than the trip already is.
 *
 * Nothing downstream re-checks this. Lowering 25 to 20 does not move anybody:
 * twenty-five riders keep spots 1 through 25 on a bus with twenty seats, every
 * count on the roster keeps agreeing with itself, and the board finds out at
 * the trailhead. `signups_unique_spot` cannot help - it stops two people
 * sharing a spot, not a spot existing above capacity.
 *
 * Both numbers matter. The count is how many people are actually allocated; the
 * highest spot number is the floor capacity may not go under, and the two differ
 * whenever a release has left a gap.
 */
async function allocationFloor(
  tripId: string,
): Promise<{ allocated: number; highestSpot: number }> {
  const rows = await execute<{ allocated: number; highest_spot: number | null }>(
    `select count(*)::int as allocated, max(spot_number)::int as highest_spot
       from signups
      where trip_id = $1 and spot_number is not null`,
    [tripId],
  );

  return {
    allocated: rows[0]?.allocated ?? 0,
    highestSpot: rows[0]?.highest_spot ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createTrip(
  _prev: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const actor = await requireCapability("manageTrips");

  const parsed = parseTripForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;

  // A new trip is created scheduled, and a scheduled trip claims itself open
  // the moment its clock arrives - so a drop time in the past is not a harmless
  // typo, it is a trip that is live to every member the instant it is saved.
  // Only checked on create: editing a trip that has already run is normal.
  if (v.signupOpensAt.getTime() <= Date.now()) {
    return {
      error:
        "The signup open time is in the past. The trip opens itself at that moment, " +
        "so pick a time still to come.",
    };
  }

  let tripId: string;
  try {
    const rows = await execute<{ id: string }>(
      `insert into trips (
         slug, title, resort, description, depart_at, return_at, price_cents,
         capacity, waitlist_cap, signup_opens_at, signup_closes_at, signup_phrase,
         payment_window_hours, requires_dues, payment_url, status, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'scheduled',$16)
       returning id`,
      [
        v.slug, v.title, v.resort, v.description, v.departAt, v.returnAt, v.priceCents,
        v.capacity, v.waitlistCap, v.signupOpensAt, v.signupClosesAt, v.signupPhrase,
        v.paymentWindowHours, v.requiresDues, v.paymentUrl, actor.boardUserId,
      ],
    );
    tripId = rows[0].id;
  } catch (error) {
    if (isDuplicateSlug(error)) return { error: `The URL slug "${v.slug}" is already taken.` };
    throw error;
  }

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "trip.create",
    entityType: "trip",
    entityId: tripId,
    data: { slug: v.slug, title: v.title, capacity: v.capacity, priceCents: v.priceCents },
  });

  revalidatePath("/admin/trips");
  revalidatePath("/admin");
  // The member-facing home list and calendar cache trip rows under this tag.
  revalidateTag("trips");
  // Back to the list rather than the empty roster: the board's first question
  // after saving is "is it really on the schedule", and the list answers it.
  redirect("/admin/trips");
}

export async function updateTrip(
  _prev: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const actor = await requireCapability("manageTrips");

  const tripId = text(formData, "tripId");
  if (!tripId) return { error: "Missing trip id." };

  const parsed = parseTripForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;

  const floor = await allocationFloor(tripId);
  const required = Math.max(floor.allocated, floor.highestSpot);
  if (v.capacity < required) {
    return {
      error:
        `${floor.allocated} spot${floor.allocated === 1 ? " is" : "s are"} already allocated on this trip` +
        (floor.highestSpot > floor.allocated ? `, the highest being spot ${floor.highestSpot}` : "") +
        `, so capacity cannot go below ${required}. Release or cancel riders first, then lower it.`,
    };
  }

  try {
    await execute(
      `update trips
          set slug = $2, title = $3, resort = $4, description = $5, depart_at = $6,
              return_at = $7, price_cents = $8, capacity = $9, waitlist_cap = $10,
              signup_opens_at = $11, signup_closes_at = $12, signup_phrase = $13,
              payment_window_hours = $14, requires_dues = $15, payment_url = $16,
              updated_at = now()
        where id = $1`,
      [
        tripId, v.slug, v.title, v.resort, v.description, v.departAt, v.returnAt,
        v.priceCents, v.capacity, v.waitlistCap, v.signupOpensAt, v.signupClosesAt,
        v.signupPhrase, v.paymentWindowHours, v.requiresDues, v.paymentUrl,
      ],
    );
  } catch (error) {
    if (isDuplicateSlug(error)) return { error: `The URL slug "${v.slug}" is already taken.` };
    throw error;
  }

  // Price edits deliberately do not touch existing signups: signups.amount_cents
  // is a snapshot taken at claim time, so nobody's bill changes after the fact.
  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "trip.update",
    entityType: "trip",
    entityId: tripId,
    data: { slug: v.slug, capacity: v.capacity, priceCents: v.priceCents },
  });

  revalidatePath("/admin/trips");
  revalidatePath(`/admin/trips/${tripId}`);
  revalidateTag("trips");
  redirect(`/admin/trips/${tripId}`);
}

export async function setTripStatus(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageTrips");

  const tripId = text(formData, "tripId");
  const target = text(formData, "status") as TripStatus;

  const rows = await execute<{ status: TripStatus }>(
    `select status::text as status from trips where id = $1`,
    [tripId],
  );
  const current = rows[0]?.status;
  if (!current) throw new Error("Trip not found");

  if (!canTransition(current, target)) {
    throw new Error(`Cannot move a ${current} trip to ${target}`);
  }

  await execute(`update trips set status = $2, updated_at = now() where id = $1`, [
    tripId,
    target,
  ]);

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: `trip.status.${target}`,
    entityType: "trip",
    entityId: tripId,
    data: { from: current, to: target },
  });

  revalidatePath("/admin/trips");
  revalidatePath(`/admin/trips/${tripId}`);
  revalidatePath("/admin");
  revalidateTag("trips");
}

/**
 * Files a trip away. Reversible, and it destroys nothing.
 *
 * This is the ordinary end of a trip's life on the board's screens: the roster,
 * the payments and the photos all stay exactly where they were, and the trip
 * simply stops appearing in listings - member ones included, so archiving is
 * not a board-only illusion.
 */
export async function archiveTrip(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageTrips");

  const tripId = text(formData, "tripId");
  if (!tripId) throw new Error("Missing trip id");

  const rows = await execute<{ title: string }>(
    `update trips set archived_at = now(), archived_by = $2, updated_at = now()
      where id = $1 and archived_at is null
      returning title`,
    [tripId, actor.boardUserId],
  );
  if (rows.length === 0) throw new Error("That trip no longer exists, or is already archived.");

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "trip.archive",
    entityType: "trip",
    entityId: tripId,
    data: { title: rows[0].title },
  });

  revalidatePath("/admin/trips");
  revalidatePath("/admin/trips/archive");
  revalidatePath("/admin");
  revalidateTag("trips");
}

/** Puts an archived trip back on the board's list, and members' too. */
export async function restoreTrip(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageTrips");

  const tripId = text(formData, "tripId");
  if (!tripId) throw new Error("Missing trip id");

  const rows = await execute<{ title: string }>(
    `update trips set archived_at = null, archived_by = null, updated_at = now()
      where id = $1 and archived_at is not null
      returning title`,
    [tripId],
  );
  if (rows.length === 0) throw new Error("That trip no longer exists, or is not archived.");

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "trip.restore",
    entityType: "trip",
    entityId: tripId,
    data: { title: rows[0].title },
  });

  revalidatePath("/admin/trips");
  revalidatePath("/admin/trips/archive");
  revalidatePath("/admin");
  revalidateTag("trips");
}

/**
 * Destroys an archived trip and everything hanging off it.
 *
 * Only reachable from the archive, and the `archived_at is not null` guard is
 * what enforces that rather than the UI - deletion is never one click away
 * from the live list. Archiving first is the deliberate pause: it is the step
 * that makes this a decision rather than a mis-click on a busy row.
 *
 * What actually dies: every child table cascades off `trips` - signups, and
 * through them payments, plus photos and the ride sheet. For a trip that ran,
 * that includes the treasurer's reconciliation record for money that really
 * moved. The confirmation names those counts because the row itself cannot.
 *
 * The stored photos are removed BEFORE the row, because the object keys only
 * exist in `trip_photos`; cascading that away first would strand the files in
 * the bucket with nothing left pointing at them. A failure here aborts the
 * delete, which is the right way round - an orphaned object costs pennies, a
 * half-deleted trip costs an evening.
 */
export async function deleteTrip(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageTrips");

  const tripId = text(formData, "tripId");
  if (!tripId) throw new Error("Missing trip id");

  const photos = await execute<{ storage_key: string; thumbnail_key: string | null }>(
    `select p.storage_key, p.thumbnail_key
       from trip_photos p
       join trips t on t.id = p.trip_id
      where p.trip_id = $1 and t.archived_at is not null`,
    [tripId],
  );

  if (photos.length > 0) {
    const { deleteObject } = await import("@/lib/storage/r2");
    for (const photo of photos) {
      for (const key of [photo.storage_key, photo.thumbnail_key]) {
        if (key) await deleteObject(key);
      }
    }
  }

  const rows = await execute<{ title: string; slug: string; signups: number }>(
    `delete from trips
      where id = $1 and archived_at is not null
      returning title, slug,
        (select count(*)::int from signups where trip_id = $1) as signups`,
    [tripId],
  );

  if (rows.length === 0) {
    throw new Error("A trip has to be archived before it can be deleted.");
  }

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "trip.delete",
    entityType: "trip",
    entityId: tripId,
    // The row is gone, so the audit entry is the only remaining record of it.
    data: {
      slug: rows[0].slug,
      title: rows[0].title,
      signups: rows[0].signups,
      photos: photos.length,
    },
  });

  revalidatePath("/admin/trips");
  revalidatePath("/admin/trips/archive");
  revalidatePath("/admin");
  revalidateTag("trips");
  redirect("/admin/trips/archive");
}
