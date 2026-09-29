"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { execute } from "@/lib/db";
import { grantBoardSeats } from "@/lib/roster/board-seats";
import { keepCounterAtLeast, pinClaimCounter, withTripLock } from "@/lib/roster/promotion";
import type { TripStatus } from "@/lib/db/schema";
import { requireCapability } from "../_lib/actor";
import { recordAudit } from "../_lib/audit";
import { parseDenverInput } from "../_lib/datetime";
import { text } from "../_lib/form";
import { insertWithFreeSlug } from "../_lib/slug";
import { canTransition } from "../_lib/trip-status";
import { signupClosesAt as signupWindowEnd } from "@/lib/claims/signup-window";

export interface TripFormState {
  error?: string;
}

// ---------------------------------------------------------------------------
// Form parsing
// ---------------------------------------------------------------------------

interface TripValues {
  title: string;
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

type Parsed = { ok: true; value: TripValues } | { ok: false; error: string };

function parseTripForm(formData: FormData): Parsed {
  const title = text(formData, "title");
  if (!title) return { ok: false, error: "Title is required." };

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
      // Only the explicit "open" opens a trip to members who owe dues. A missing
      // or unrecognised value means dues are required, so a form that failed to
      // submit this field cannot quietly turn the gate off on a trip the board
      // meant to restrict - the direction that would be discovered at the drop.
      requiresDues: formData.get("requiresDues") !== "open",
      paymentUrl: text(formData, "paymentUrl") || null,
    },
  };
}

/**
 * Every trip mutation shows up on the same few board screens, and the
 * member-facing home list and calendar cache trip rows under the "trips" tag.
 */
function refreshTrips(tripId?: string): void {
  revalidatePath("/admin/trips");
  revalidatePath("/admin");
  if (tripId) revalidatePath(`/admin/trips/${tripId}`);
  revalidateTag("trips");
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

  const created = await insertWithFreeSlug(v.title, async (slug) => {
    const rows = await execute<{ id: string }>(
      `insert into trips (
         slug, title, resort, description, depart_at, return_at, price_cents,
         capacity, waitlist_cap, signup_opens_at, signup_closes_at, signup_phrase,
         payment_window_hours, requires_dues, payment_url, status, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'scheduled',$16)
       returning id`,
      [
        slug, v.title, v.resort, v.description, v.departAt, v.returnAt, v.priceCents,
        v.capacity, v.waitlistCap, v.signupOpensAt, v.signupClosesAt, v.signupPhrase,
        v.paymentWindowHours, v.requiresDues, v.paymentUrl, actor.boardUserId,
      ],
    );
    return rows[0].id;
  });
  if (!created) return { error: "The title needs at least one letter or number." };
  const tripId = created.result;

  /*
    The board is on its own trips by default, comped, from the moment the trip
    exists - rather than by somebody remembering to add eight people before the
    drop. Whoever is not actually coming is removed during curation, which costs
    no member a spot because these seats were never part of the count.

    Deliberately not inside the insert's failure path: a trip that saved but
    whose seats did not is a trip, and the board can add themselves by hand. A
    trip that failed to save because of a seat would be neither.
  */
  let boardSeats = 0;
  try {
    boardSeats = await withTripLock(tripId, (client) =>
      grantBoardSeats(client, tripId, actor.boardUserId),
    );
  } catch (error) {
    console.error("board seats not granted on create", tripId, error);
  }

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "trip.create",
    entityType: "trip",
    entityId: tripId,
    data: {
      slug: created.slug,
      title: v.title,
      capacity: v.capacity,
      priceCents: v.priceCents,
      boardSeats,
    },
  });

  refreshTrips();
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

  // Capacity is a target, so any value saves - even below who is already on the
  // trip. What must hold is the claim arithmetic, since signups may still be
  // open: the counter has to clear every spot already filled and every
  // waitlist position, or raising capacity mid-drop lets a later claim derive a
  // position that exists and every entrant after it gets an error.
  await withTripLock(tripId, async (client) => {
    await client.query(
      `update trips
          set title = $2, resort = $3, description = $4, depart_at = $5,
              return_at = $6, price_cents = $7, capacity = $8, waitlist_cap = $9,
              signup_opens_at = $10, signup_closes_at = $11, signup_phrase = $12,
              payment_window_hours = $13, requires_dues = $14, payment_url = $15,
              updated_at = now()
        where id = $1`,
      [
        tripId, v.title, v.resort, v.description, v.departAt, v.returnAt,
        v.priceCents, v.capacity, v.waitlistCap, v.signupOpensAt, v.signupClosesAt,
        v.signupPhrase, v.paymentWindowHours, v.requiresDues, v.paymentUrl,
      ],
    );
    const { rows } = await client.query<{ waitlisted: number; highest: number }>(
      `select count(*) filter (where status = 'waitlisted')::int as waitlisted,
              coalesce(max(spot_number), 0)::int as highest
         from signups where trip_id = $1`,
      [tripId],
    );
    await keepCounterAtLeast(client, tripId, rows[0].highest);
    if (rows[0].waitlisted > 0) await pinClaimCounter(client, tripId, rows[0].waitlisted);
  });

  // Price edits deliberately do not touch existing signups: signups.amount_cents
  // is a snapshot taken at claim time, so nobody's bill changes after the fact.
  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "trip.update",
    entityType: "trip",
    entityId: tripId,
    data: { capacity: v.capacity, priceCents: v.priceCents },
  });

  refreshTrips(tripId);
  redirect(`/admin/trips/${tripId}`);
}

export async function setTripStatus(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageTrips");

  const tripId = text(formData, "tripId");
  const target = text(formData, "status") as TripStatus;

  const rows = await execute<{ status: TripStatus; released: boolean }>(
    `select status::text as status, results_released_at is not null as released
       from trips where id = $1`,
    [tripId],
  );
  const current = rows[0]?.status;
  if (!current) throw new Error("Trip not found");

  if (!canTransition(current, target)) {
    throw new Error(`Cannot move a ${current} trip to ${target}`);
  }

  /*
    Release published the roster and closed signups in one irreversible press.
    The generic closed->scheduled transition exists for a trip closed early by
    hand; on a released trip it would put the claim statement back in business
    against a roster members have already been shown. The stage logic on the
    trip page never offers this, but the server action is what actually
    decides.
  */
  if (rows[0].released && (target === "scheduled" || target === "open")) {
    throw new Error("The roster has been released; signups cannot be reopened.");
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

  refreshTrips(tripId);
}

/**
 * Destroys a trip and everything hanging off it. There is no undo and no
 * softer alternative - the confirmation on the trips list is the only pause.
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
    `select storage_key, thumbnail_key from trip_photos where trip_id = $1`,
    [tripId],
  );

  if (photos.length > 0) {
    const { deleteObject } = await import("@/lib/photos/r2");
    for (const photo of photos) {
      for (const key of [photo.storage_key, photo.thumbnail_key]) {
        if (key) await deleteObject(key);
      }
    }
  }

  const rows = await execute<{ title: string; slug: string; signups: number }>(
    `delete from trips
      where id = $1
      returning title, slug,
        (select count(*)::int from signups where trip_id = $1) as signups`,
    [tripId],
  );

  if (rows.length === 0) {
    throw new Error("That trip no longer exists.");
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

  refreshTrips();
  redirect("/admin/trips");
}
