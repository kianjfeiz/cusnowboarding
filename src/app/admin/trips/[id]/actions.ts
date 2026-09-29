"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { execute } from "@/lib/db";
import { renumberWaitlist, withTripLock } from "@/lib/roster/promotion";
import { releaseResults } from "@/lib/roster/results";
import {
  addMemberToTrip,
  type RosterAddDestination,
  type RosterAddFailure,
} from "@/lib/roster/roster-add";
import { applyRosterAssignment, type RosterAssignmentResult } from "@/lib/roster/roster-edit";
import type { RosterSaveResult } from "@/components/admin/roster-board";
import { requireCapability } from "../../_lib/actor";
import { recordAudit } from "../../_lib/audit";
import { text } from "../../_lib/form";
import { searchAddableMembers, type AddableMember } from "../../_lib/queries";

/**
 * Publishes the roster and emails the riders on it. The ONLY button after a drop: it
 * also closes signups, restarts every payment deadline and finalizes the
 * roster. See releaseResults for why each of those belongs to this moment.
 */
export async function releaseTripResults(formData: FormData): Promise<void> {
  const actor = await requireCapability("managePromotions");

  const tripId = text(formData, "tripId");
  const result = await releaseResults(tripId, actor.boardUserId);

  if (!result.ok) {
    throw new Error(
      result.reason === "already_released"
        ? "This roster has already been released"
        : result.reason === "cancelled"
          ? "This trip is cancelled"
          : "Trip not found",
    );
  }

  refreshTrip(tripId);
}

/**
 * The board posts the whole ordering, not a diff. A full ordering can simply be
 * rejected if the set of people changed underneath the coordinator, which is
 * the honest outcome when someone claimed or cancelled mid-edit.
 */
export async function saveRosterOrder(
  tripId: string,
  onTrip: string[],
  waitlisted: string[],
): Promise<RosterSaveResult> {
  const actor = await requireCapability("managePromotions");

  if (!Array.isArray(onTrip) || !Array.isArray(waitlisted)) {
    return {
      ok: false,
      message: "That ordering could not be read. Reload and try again.",
    };
  }

  const result = await applyRosterAssignment(tripId, actor.boardUserId, {
    onTrip,
    waitlisted,
  });

  if (!result.ok) return { ok: false, message: refusalMessage(result) };

  refreshTrip(tripId);

  const moved = (result.movedToTrip?.length ?? 0) + (result.movedToWaitlist?.length ?? 0);
  return {
    ok: true,
    message:
      `${result.onTripCount} on the trip, ${result.waitlistCount} waitlisted` +
      `${moved > 0 ? `, ${moved} moved between lists` : ""}. ` +
      (result.released
        ? "Nobody is emailed - tell anyone you moved."
        : "Nobody has been told anything yet."),
  };
}

function refusalMessage(result: RosterAssignmentResult): string {
  switch (result.reason) {
    case "cannot_move_paid":
      return `${result.signupName ?? "That rider"} has already paid. Remove them from the trip and refund them instead.`;
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

/** Capability-gated although it only reads: it pages through the member directory. */
export async function searchMembersToAdd(tripId: string, query: string): Promise<AddableMember[]> {
  await requireCapability("managePromotions");
  return searchAddableMembers(tripId, String(query ?? ""));
}

const ADD_FAILURES: Record<RosterAddFailure, string> = {
  already_active: "They are already on this trip or its waitlist.",
  no_free_spot: "Every spot is taken. Remove someone first, or add them to the waitlist.",
  spots_open: "The trip still has open spots for the drop. Add them to the trip instead.",
  member_blocked: "That member is blocked.",
  member_missing: "That member no longer exists.",
  trip_missing: "That trip no longer exists.",
};

/**
 * Puts a member on the trip or the waitlist by hand. No email is sent, so a
 * post-release add leaves someone on a payment clock they have not been told
 * about - the returned message says so, because telling them is the board's job.
 */
export async function addRiderToTrip(
  tripId: string,
  memberId: string,
  to: RosterAddDestination,
): Promise<RosterSaveResult> {
  const actor = await requireCapability("managePromotions");

  if (to !== "trip" && to !== "waitlist") {
    return { ok: false, message: "That is not a list on this trip." };
  }

  const result = await addMemberToTrip(tripId, memberId, actor.boardUserId, to);
  if (!result.ok) return { ok: false, message: ADD_FAILURES[result.reason] };

  refreshTrip(tripId);

  // A board seat carries no deadline, so there is nothing to warn about.
  const notice = result.boardSeat
    ? ""
    : result.resultsReleased
      ? " They are NOT emailed - tell them yourself, or send the unpaid email from Payments."
      : " Nobody has been told anything yet.";

  const where =
    result.status === "board"
      ? "the trip on a board seat (free, and not one of the spots)"
      : result.status === "held"
        ? `spot ${result.spotNumber}`
        : "the end of the waitlist";

  return {
    ok: true,
    message: `${result.memberName} added to ${where}.${notice}`,
  };
}

type SignupContext = {
  trip_id: string;
  status: string;
  member_id: string;
  board_seat: boolean;
};

async function loadSignup(signupId: string): Promise<SignupContext> {
  const rows = await execute<SignupContext>(
    `select trip_id, status::text as status, member_id, board_seat
       from signups where id = $1`,
    [signupId],
  );
  const row = rows[0];
  if (!row) throw new Error("Signup not found");
  return row;
}

function refreshTrip(tripId: string): void {
  revalidatePath(`/admin/trips/${tripId}`);
  revalidatePath("/admin/trips");
  revalidatePath("/admin");
  // The shared member-facing caches key off this tag.
  revalidateTag("trips");
}

/**
 * Give the spot back. The signup keeps its claim_seq forever - order is
 * history, occupancy is not - so releasing only clears spot_number, which is
 * what makes the freed spot visible to promotion.
 */
export async function releaseSpot(formData: FormData): Promise<void> {
  const actor = await requireCapability("managePromotions");

  const signupId = text(formData, "signupId");
  const reason = "board_release";
  const signup = await loadSignup(signupId);

  if (signup.status !== "held") {
    throw new Error("That rider has paid or already been removed. Reload the roster.");
  }

  // Under the trips row lock like every other write that moves a spot, even
  // though this one only nulls a number: one write outside the ordering is how
  // a deadlock gets introduced later.
  const released = await withTripLock(signup.trip_id, async (client) => {
    const result = await client.query(
      `update signups
          set status = 'expired', spot_number = null, released_at = now(),
              release_reason = $2, updated_at = now()
        where id = $1 and status = 'held'`,
      [signupId, reason],
    );
    return (result.rowCount ?? 0) > 0;
  });

  // The status was read before the lock, so a concurrent action can win and the
  // guarded UPDATE match nothing. No mutation, no audit row.
  if (released) {
    await recordAudit({
      actorBoardUserId: actor.boardUserId,
      action: "signup.release",
      entityType: "signup",
      entityId: signupId,
      data: { tripId: signup.trip_id, memberId: signup.member_id, reason },
    });
  }

  refreshTrip(signup.trip_id);
}

export async function cancelSignup(formData: FormData): Promise<void> {
  const signupId = text(formData, "signupId");

  // Read first so the capability matches the row. Cancelling a paid rider is a
  // money decision, so it is the treasurer's - but a comped board seat reads as
  // `paid` with no money involved, and taking one back is roster work.
  const signup = await loadSignup(signupId);
  const actor = await requireCapability(
    signup.status === "paid" && !signup.board_seat ? "managePayments" : "managePromotions",
  );

  if (!["held", "paid", "waitlisted"].includes(signup.status)) {
    throw new Error("That signup is already inactive");
  }

  const cancelled = await withTripLock(signup.trip_id, async (client) => {
    const result = await client.query(
      `update signups
          set status = 'cancelled', spot_number = null, waitlist_position = null,
              released_at = now(), release_reason = 'board_cancel', updated_at = now()
        where id = $1 and status in ('held','paid','waitlisted')`,
      [signupId],
    );
    const changed = (result.rowCount ?? 0) > 0;

    // Close the hole a cancelled waitlister leaves, so the list never reads
    // 1, 2, 4, 5.
    if (changed && signup.status === "waitlisted") {
      await renumberWaitlist(client, signup.trip_id);
    }
    return changed;
  });

  // Same reasoning as releaseSpot: no mutation, no audit row.
  if (cancelled) {
    await recordAudit({
      actorBoardUserId: actor.boardUserId,
      action: "signup.cancel",
      entityType: "signup",
      entityId: signupId,
      data: {
        tripId: signup.trip_id,
        memberId: signup.member_id,
        from: signup.status,
      },
    });
  }

  refreshTrip(signup.trip_id);
}
