"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { execute } from "@/lib/db";
import { promoteFromWaitlist, renumberWaitlist, withTripLock } from "@/lib/promotion";
import { releaseResults } from "@/lib/results";
import {
  addMemberToTrip,
  type RosterAddDestination,
  type RosterAddFailure,
} from "@/lib/roster-add";
import { applyRosterAssignment, type RosterEditRefusal } from "@/lib/roster-edit";
import { sendEmail } from "@/lib/email/send";
import { gotASpotEmail, waitlistedEmail } from "@/lib/email/result-templates";
import { promotedEmail } from "@/lib/email/templates";
import type { RosterSaveResult } from "@/components/admin/roster-board";
import { requireCapability } from "../../_lib/actor";
import { recordAudit } from "../../_lib/audit";
import { searchAddableMembers, type AddableMember } from "../../_lib/queries";

/**
 * Publishes outcomes to everyone who entered.
 *
 * The board takes fifteen or twenty minutes after a drop to curate the waitlist
 * before anyone is told anything, so this is a deliberate button rather than
 * something the drop does on its own. It is also the ONLY button: it closes
 * signups, publishes outcomes, restarts every payment deadline and finalizes
 * the roster. See releaseResults for why each of those belongs to this moment
 * rather than to a separate press the board has to remember.
 */
export async function releaseTripResults(formData: FormData): Promise<void> {
  const actor = await requireCapability("managePromotions");

  const tripId = String(formData.get("tripId") ?? "");
  const result = await releaseResults(tripId, actor.boardUserId);

  if (!result.ok) {
    throw new Error(
      result.reason === "already_released"
        ? "Results for this trip have already been sent"
        : "Trip not found",
    );
  }

  refreshTrip(tripId);
}

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

  refreshTrip(tripId);

  const moved = (result.movedToTrip?.length ?? 0) + (result.movedToWaitlist?.length ?? 0);
  return {
    ok: true,
    message:
      `${result.onTripCount} on the trip, ${result.waitlistCount} waitlisted` +
      `${moved > 0 ? `, ${moved} moved between lists` : ""}. ` +
      "Nobody has been told anything yet.",
  };
}

function refusalMessage(
  reason: RosterEditRefusal | undefined,
  result: { signupName?: string; capacity?: number; onTripCount?: number },
): string {
  switch (reason) {
    case "already_released":
      return (
        "Results for this trip have already been sent. Reload the page - moving " +
        "someone now goes through Release, Cancel, or Promote, so they are told."
      );
    case "over_capacity":
      return `${result.onTripCount} people for ${result.capacity} spots.`;
    case "cannot_move_paid":
      return `${result.signupName ?? "That rider"} has already paid. Refund and cancel them instead.`;
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

/**
 * Typeahead behind the "Add a rider" box.
 *
 * A read, but still capability-gated: the whole member directory is not
 * something an unauthenticated caller gets to page through one query string at
 * a time.
 */
export async function searchMembersToAdd(
  tripId: string,
  query: string,
): Promise<AddableMember[]> {
  await requireCapability("managePromotions");
  return searchAddableMembers(tripId, String(query ?? ""));
}

/**
 * Puts a member on the trip or the waitlist by hand.
 *
 * Whether this notifies is decided by the trip, not by the board: before
 * results are out nobody has been told anything and a silent add matches every
 * other pre-release move, while afterwards the person is holding a spot with a
 * payment clock running against it. Sending that email is the difference
 * between adding someone and stranding them.
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

  if (!result.ok) {
    return { ok: false, message: addFailureMessage(result.reason) };
  }

  refreshTrip(tripId);

  // After the commit, and never allowed to undo it: a mail provider outage
  // must not take back a spot the board has already given away.
  let notice = "";
  if (result.boardSeat) {
    // The board is not emailed about the trips it runs, so there is nothing to
    // report beyond what the seat is.
    notice = "";
  } else if (result.resultsReleased) {
    try {
      if (result.status === "held") {
        await sendEmail(
          gotASpotEmail({
            to: result.memberEmail,
            firstName: result.memberFirstName,
            tripTitle: result.tripTitle,
            spotNumber: result.spotNumber ?? 0,
            amountCents: result.amountCents,
            deadline: result.paymentDeadlineAt ?? new Date(),
            payToken: result.payToken,
          }),
        );
      } else {
        await sendEmail(
          waitlistedEmail({
            to: result.memberEmail,
            firstName: result.memberFirstName,
            tripTitle: result.tripTitle,
          }),
        );
      }
      notice = " They have been emailed.";
    } catch (error) {
      console.error("board add notice failed", result.signupId, error);
      notice = " The email failed to send - tell them yourself.";
    }
  } else {
    notice = " Nobody has been told anything yet.";
  }

  const where =
    result.status === "board"
      ? "the trip on a free board seat, which does not use one of the spots"
      : result.status === "held"
        ? `spot ${result.spotNumber}`
        : "the end of the waitlist";

  return {
    ok: true,
    message: `${result.memberName} added to ${where}.${notice}`,
  };
}

function addFailureMessage(reason: RosterAddFailure): string {
  switch (reason) {
    case "already_active":
      return "They are already on this trip or its waitlist.";
    case "no_free_spot":
      return "Every spot is taken. Release someone first, or add them to the waitlist.";
    case "member_blocked":
      return "That member is blocked.";
    case "member_missing":
      return "That member no longer exists.";
    case "trip_missing":
      return "That trip no longer exists.";
  }
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
  // Roster and results changes touch the trips table too, and the shared
  // member-facing caches key off this tag.
  revalidateTag("trips");
}

/**
 * Give the spot back. The signup keeps its claim_seq forever - order is
 * history, occupancy is not - so releasing only clears spot_number, which is
 * what makes the freed spot visible to promotion.
 */
export async function releaseSpot(formData: FormData): Promise<void> {
  const actor = await requireCapability("managePromotions");

  const signupId = String(formData.get("signupId") ?? "");
  const reason = String(formData.get("reason") ?? "board_release");
  const signup = await loadSignup(signupId);

  if (signup.status !== "held") {
    throw new Error("Only a held spot can be released");
  }

  // Takes the trips row lock first, like every other path that moves a spot
  // around (promoteFromWaitlist, applyRosterAssignment, releaseResults). This
  // one only ever nulls a spot number so it cannot corrupt the numbering on its
  // own, but leaving a single write outside the ordering is how a deadlock gets
  // introduced later by someone who assumes the rule holds everywhere.
  await withTripLock(signup.trip_id, async (client) => {
    await client.query(
      `update signups
          set status = 'expired', spot_number = null, released_at = now(),
              release_reason = $2, updated_at = now()
        where id = $1 and status = 'held'`,
      [signupId, reason],
    );
  });

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "signup.release",
    entityType: "signup",
    entityId: signupId,
    data: { tripId: signup.trip_id, memberId: signup.member_id, reason },
  });

  refreshTrip(signup.trip_id);
}

/**
 * Cancelling someone who has already paid is a money decision, not a roster
 * one, so it is gated on the treasurer's capability instead.
 *
 * A cancelled waitlister leaves a gap in the waitlist numbering until the next
 * promotion renumbers the list. Positions stay unique, so nothing breaks; the
 * ordering that matters is claim_seq, which never changes.
 */
export async function cancelSignup(formData: FormData): Promise<void> {
  const signupId = String(formData.get("signupId") ?? "");

  // Read first so the capability required matches the row's actual state. A
  // comped board seat reads as `paid` but no money was ever involved, so taking
  // one back is roster work, not the treasurer's - gating it on managePayments
  // would mean the coordinator running the trip could not remove a board member
  // who is not coming.
  const signup = await loadSignup(signupId);
  const actor = await requireCapability(
    signup.status === "paid" && !signup.board_seat ? "managePayments" : "managePromotions",
  );

  if (!["held", "paid", "waitlisted"].includes(signup.status)) {
    throw new Error("That signup is already inactive");
  }

  await withTripLock(signup.trip_id, async (client) => {
    await client.query(
      `update signups
          set status = 'cancelled', spot_number = null, waitlist_position = null,
              released_at = now(), release_reason = 'board_cancel', updated_at = now()
        where id = $1 and status in ('held','paid','waitlisted')`,
      [signupId],
    );

    // Cancelling a waitlister would otherwise leave a hole in the numbering
    // until the next promotion happened to close it. Positions stay unique
    // either way, but a list that reads 1, 2, 4, 5 makes the board wonder what
    // it is looking at.
    if (signup.status === "waitlisted") {
      await renumberWaitlist(client, signup.trip_id);
    }
  });

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "signup.cancel",
    entityType: "signup",
    entityId: signupId,
    data: { tripId: signup.trip_id, memberId: signup.member_id, from: signup.status },
  });

  refreshTrip(signup.trip_id);
}

/**
 * Promotion itself lives in lib/promotion.ts, which takes the trip row lock and
 * re-checks that a spot is genuinely free. The disabled button here is a
 * courtesy; that transaction is the guarantee.
 */
export async function promoteSignup(formData: FormData): Promise<void> {
  const actor = await requireCapability("managePromotions");

  const signupId = String(formData.get("signupId") ?? "");
  const signup = await loadSignup(signupId);

  const result = await promoteFromWaitlist(signupId, actor.boardUserId);
  if (!result.ok) {
    throw new Error(
      result.reason === "no_free_spot"
        ? "No spot is free on that trip right now"
        : "That signup is no longer on the waitlist",
    );
  }

  // A promotion nobody is told about is worthless: the member has a payment
  // deadline running against a spot they do not know they have. Sent after the
  // transaction commits, and a mail failure must not undo the promotion.
  try {
    const [details] = await execute<{
      trip_title: string;
      pay_token: string;
      amount_cents: number;
      email: string;
      first_name: string;
    }>(
      `select t.title as trip_title, s.pay_token, s.amount_cents,
              m.email::text as email, m.first_name
         from signups s
         join trips t on t.id = s.trip_id
         join members m on m.id = s.member_id
        where s.id = $1`,
      [signupId],
    );

    if (details && result.spotNumber && result.paymentDeadlineAt) {
      await sendEmail(
        promotedEmail({
          to: details.email,
          firstName: details.first_name,
          tripTitle: details.trip_title,
          spotNumber: result.spotNumber,
          amountCents: details.amount_cents,
          deadline: result.paymentDeadlineAt,
          payToken: details.pay_token,
        }),
      );
    }
  } catch (error) {
    console.error("promotion notice failed", signupId, error);
  }

  refreshTrip(signup.trip_id);
}
