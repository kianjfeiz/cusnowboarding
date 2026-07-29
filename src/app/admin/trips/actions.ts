"use server";

import { revalidatePath } from "next/cache";
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
  returnAt: Date | null;
  priceCents: number;
  capacity: number;
  waitlistCap: number | null;
  signupOpensAt: Date;
  signupClosesAt: Date | null;
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
  if (returnAt && returnAt < departAt) {
    return { ok: false, error: "The return time is before the departure time." };
  }

  const signupOpensAt = parseDenverInput(text(formData, "signupOpensAt"));
  if (!signupOpensAt) return { ok: false, error: "Signups must have an opening time." };

  // Derived, not entered. The drop is decided in the first seconds, so a manual
  // close time was only ever another field to get wrong.
  const signupClosesAt = signupWindowEnd(signupOpensAt);

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
         capacity, waitlist_cap, signup_opens_at, signup_closes_at,
         payment_window_hours, requires_dues, payment_url, status, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'scheduled',$15)
       returning id`,
      [
        v.slug, v.title, v.resort, v.description, v.departAt, v.returnAt, v.priceCents,
        v.capacity, v.waitlistCap, v.signupOpensAt, v.signupClosesAt,
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
              signup_opens_at = $11, signup_closes_at = $12,
              payment_window_hours = $13, requires_dues = $14, payment_url = $15,
              updated_at = now()
        where id = $1`,
      [
        tripId, v.slug, v.title, v.resort, v.description, v.departAt, v.returnAt,
        v.priceCents, v.capacity, v.waitlistCap, v.signupOpensAt, v.signupClosesAt,
        v.paymentWindowHours, v.requiresDues, v.paymentUrl,
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
}
