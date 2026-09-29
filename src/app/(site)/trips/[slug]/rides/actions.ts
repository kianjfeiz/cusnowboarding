"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentMember } from "@/lib/auth/current-member";
import { getTripBySlug } from "@/lib/trips/trips";
import { canUseRideSheet, cancelRide, claimSeat, offerRide, releaseSeat } from "@/lib/trips/rides";

/**
 * Every action re-checks the sheet gate itself: a form can be submitted long
 * after the page rendered, and the audience rule has to hold at write time.
 */
async function requireRider(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  const trip = await getTripBySlug(slug);
  if (!trip) redirect("/me");

  const member = await currentMember();
  if (!member || !(await canUseRideSheet(trip.id, member.id))) {
    redirect(`/trips/${slug}/rides`);
  }

  return { slug, trip, member };
}

function back(slug: string, error?: string): never {
  revalidatePath(`/trips/${slug}/rides`);
  redirect(error ? `/trips/${slug}/rides?error=${error}` : `/trips/${slug}/rides`);
}

export async function offerRideAction(formData: FormData): Promise<void> {
  const { slug, trip, member } = await requireRider(formData);

  const result = await offerRide(trip.id, member.id, {
    seatCapacity: Number(formData.get("seats") ?? 0),
    phone: String(formData.get("phone") ?? ""),
    departsNote: String(formData.get("departs") ?? ""),
    returnsNote: String(formData.get("returns") ?? "") || null,
  });

  back(slug, result.ok ? undefined : result.reason);
}

export async function claimSeatAction(formData: FormData): Promise<void> {
  const { slug, trip, member } = await requireRider(formData);
  const rideId = String(formData.get("rideId") ?? "");

  const result = await claimSeat(rideId, trip.id, member.id, String(formData.get("phone") ?? ""));
  back(slug, result.ok ? undefined : result.reason);
}

export async function releaseSeatAction(formData: FormData): Promise<void> {
  const { slug, trip, member } = await requireRider(formData);
  await releaseSeat(trip.id, member.id);
  back(slug);
}

export async function cancelRideAction(formData: FormData): Promise<void> {
  const { slug, trip, member } = await requireRider(formData);
  await cancelRide(trip.id, member.id);
  back(slug);
}
