"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMemberSession } from "@/lib/member-session";
import { loadVerifiedMember } from "@/lib/verification";
import { getTripBySlug } from "@/lib/trips";
import { canUseRideSheet, cancelRide, claimSeat, offerRide, releaseSeat } from "@/lib/rides";

/**
 * Every action re-resolves identity and re-checks the sheet gate itself. The
 * page checked already, but a form can be submitted long after the page
 * rendered - after a hold lapsed, after the member was moved to the waitlist -
 * and the sheet's audience rule has to hold at write time, not render time.
 */
async function requireRider(slug: string) {
  const trip = await getTripBySlug(slug);
  if (!trip) redirect("/me");

  const session = await getMemberSession();
  const member = session
    ? await loadVerifiedMember(session.memberId, session.tokenVersion)
    : null;
  if (!member || !(await canUseRideSheet(trip.id, member.id))) {
    redirect(`/trips/${slug}/rides`);
  }

  return { trip, member };
}

function back(slug: string, error?: string): never {
  revalidatePath(`/trips/${slug}/rides`);
  redirect(error ? `/trips/${slug}/rides?error=${error}` : `/trips/${slug}/rides`);
}

export async function offerRideAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const { trip, member } = await requireRider(slug);

  const result = await offerRide(trip.id, member.id, {
    seatCapacity: Number(formData.get("seats") ?? 0),
    phone: String(formData.get("phone") ?? ""),
    departsNote: String(formData.get("departs") ?? ""),
    returnsNote: String(formData.get("returns") ?? "") || null,
  });

  back(slug, result.ok ? undefined : result.reason);
}

export async function claimSeatAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const rideId = String(formData.get("rideId") ?? "");
  const { trip, member } = await requireRider(slug);

  const result = await claimSeat(rideId, trip.id, member.id, String(formData.get("phone") ?? ""));
  back(slug, result.ok ? undefined : result.reason);
}

export async function releaseSeatAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const { trip, member } = await requireRider(slug);
  await releaseSeat(trip.id, member.id);
  back(slug);
}

export async function cancelRideAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const { trip, member } = await requireRider(slug);
  await cancelRide(trip.id, member.id);
  back(slug);
}
