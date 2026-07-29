"use server";

import { revalidatePath } from "next/cache";
import { applyRosterAssignment, type RosterEditRefusal } from "@/lib/roster-edit";
import type { RosterSaveResult } from "@/components/admin/roster-board";
import { requireCapability } from "../../../_lib/actor";

/**
 * The board posts the whole ordering, not a diff. A diff would have to be
 * rebased against whatever the roster looks like now; a full ordering can simply
 * be rejected if the set of people has changed underneath the coordinator, which
 * is the honest outcome when someone claimed or cancelled mid-edit.
 */
export async function saveRosterOrder(
  tripId: string,
  onTrip: string[],
  waitlisted: string[],
): Promise<RosterSaveResult> {
  const actor = await requireCapability("managePromotions");

  if (!Array.isArray(onTrip) || !Array.isArray(waitlisted)) {
    return { ok: false, message: "That ordering could not be read. Reload and try again." };
  }

  const result = await applyRosterAssignment(tripId, actor.boardUserId, {
    onTrip,
    waitlisted,
  });

  if (!result.ok) {
    return { ok: false, message: refusalMessage(result.reason, result) };
  }

  revalidatePath(`/admin/trips/${tripId}/roster-editor`);
  revalidatePath(`/admin/trips/${tripId}`);
  revalidatePath("/admin/trips");
  revalidatePath("/admin");

  const moved = (result.movedToTrip?.length ?? 0) + (result.movedToWaitlist?.length ?? 0);
  return {
    ok: true,
    message:
      `${result.onTripCount} on the trip, ${result.waitlistCount} waitlisted` +
      `${moved > 0 ? `, ${moved} moved between lists` : ""}. ` +
      "Nobody has been told anything yet - send results when the list is right.",
  };
}

function refusalMessage(
  reason: RosterEditRefusal | undefined,
  result: { signupName?: string; capacity?: number; onTripCount?: number },
): string {
  switch (reason) {
    case "already_released":
      return (
        "Results for this trip have already been sent. Moving someone now has to go " +
        "through Release, Cancel, or Promote on the roster, so they are told."
      );
    case "over_capacity":
      return `${result.onTripCount} people for ${result.capacity} spots.`;
    case "cannot_move_paid":
      return `${result.signupName ?? "That rider"} has already paid. Refund and cancel them on the roster instead.`;
    case "missing_signup":
      return (
        `${result.signupName ?? "Someone"} is on this trip but was not in the list you saved. ` +
        "The roster changed while you were editing - reload and redo the changes."
      );
    case "unknown_signup":
    case "duplicate_signup":
      return "That ordering no longer matches the roster. Reload and redo the changes.";
    case "trip_missing":
      return "That trip no longer exists.";
    default:
      return "The roster could not be saved.";
  }
}
