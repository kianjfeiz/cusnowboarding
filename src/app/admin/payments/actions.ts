"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { execute } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { outstandingBalanceEmail } from "@/lib/email/templates";
import { reinstateSignup } from "@/lib/roster/reinstate";
import { requireCapability } from "../_lib/actor";
import { recordAudit } from "../_lib/audit";
import { text } from "../_lib/form";
import { paymentSummary } from "../_lib/payment-queries";
import { parsePaymentProvider } from "@/lib/money/payment-providers";
import { MAX_BATCH, listUnpaidRecipients } from "./unpaid";

function refresh(tripId: string | null): void {
  revalidatePath("/admin/payments");
  revalidatePath("/admin/trips");
  revalidatePath("/admin");
  if (tripId) revalidatePath(`/admin/trips/${tripId}`);
}

/** How the money came in, as the forms submit it. Fusion unless they say otherwise. */
function paymentSource(formData: FormData) {
  return {
    provider: parsePaymentProvider(text(formData, "provider")),
    reference: text(formData, "reference") || null,
    note: text(formData, "note") || null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Most one batch can mark: a whole trip's worth, with room to spare. */
const MAX_MARK = 200;

/**
 * Marks one held spot paid and records where the money came from. Returns the
 * trip id, or null when the spot was no longer held.
 *
 * One statement. The `status = 'held'` guard lives inside the update rather than
 * in a read-then-write, so two treasurers clicking at once cannot both stamp a
 * paid_at; the loser matches no row and the insert, which selects from the
 * update, writes nothing either. The amount is always what the spot costs; the
 * club does not take part payments.
 */
async function markPaid(
  signupId: string,
  source: ReturnType<typeof paymentSource>,
  boardUserId: string,
): Promise<string | null> {
  const { provider, reference, note } = source;
  const rows = await execute<{
    trip_id: string;
    member_id: string;
    payment_id: string;
    recorded_cents: number;
  }>(
    `with paid as (
       update signups
          set status = 'paid', paid_at = now(), paid_offline = true,
              offline_note = $2, updated_at = now()
        where id = $1 and status = 'held'
        returning id, trip_id, member_id, amount_cents, paid_at
     ),
     recorded as (
       insert into payments (signup_id, provider, reference, amount_cents,
                             status, paid_at, note, recorded_by)
       select paid.id, $3, $4, paid.amount_cents, 'paid',
              paid.paid_at, $5, $6::uuid
         from paid
       returning id, amount_cents
     )
     select paid.trip_id, paid.member_id, recorded.id as payment_id,
            recorded.amount_cents as recorded_cents
       from paid join recorded on true`,
    [signupId, paymentSummary({ provider, reference, note }), provider, reference, note, boardUserId],
  );

  const row = rows[0];
  if (!row) return null;

  await recordAudit({
    actorBoardUserId: boardUserId,
    action: "signup.record_payment",
    entityType: "signup",
    entityId: signupId,
    data: {
      tripId: row.trip_id,
      memberId: row.member_id,
      paymentId: row.payment_id,
      amountCents: row.recorded_cents,
      provider,
      reference,
      note,
    },
  });
  return row.trip_id;
}

/**
 * Marks spots paid. The everyday case is the treasurer going down the Fusion
 * export: one click per row, or a batch ticked off at once, recorded as Fusion.
 * Cash, Venmo and the rest come through the same action with a provider and an
 * optional note.
 *
 * The app never sees the money: the `payments` row and the audit row are the
 * durable answer to "why does this say paid", and to who said so.
 *
 * `only` is the one row whose own button was pressed; otherwise every ticked
 * `signupIds` box is marked.
 */
export async function recordPaymentAction(formData: FormData): Promise<void> {
  const actor = await requireCapability("managePayments");

  const only = text(formData, "only");
  const ids = (only ? [only] : formData.getAll("signupIds").map(String)).filter((id) =>
    UUID.test(id),
  );
  if (ids.length === 0) return;
  if (ids.length > MAX_MARK) throw new Error(`Mark at most ${MAX_MARK} at once.`);

  const source = paymentSource(formData);
  const trips = new Set<string>();
  for (const id of new Set(ids)) {
    const tripId = await markPaid(id, source, actor.boardUserId);
    if (tripId) trips.add(tripId);
  }

  refresh(null);
  for (const tripId of trips) revalidatePath(`/admin/trips/${tripId}`);
}

/**
 * Puts a rider whose spot was released back on the trip.
 *
 * The transaction in lib/roster/reinstate.ts is the guarantee: it takes the trip
 * row lock, re-checks that a spot is free, and writes the audit row. No email is
 * sent - the member believes they are off the trip, so telling them is the
 * treasurer's job.
 */
export async function reinstateSignupAction(formData: FormData): Promise<void> {
  const actor = await requireCapability("managePayments");

  const signupId = text(formData, "signupId");
  // Absent when the "money already received" checkbox is left alone.
  const markPaid = formData.get("markPaid") !== null;
  const { provider, reference, note } = paymentSource(formData);

  const result = await reinstateSignup(signupId, actor.boardUserId, {
    markPaid,
    provider,
    reference,
    note,
    offlineNote: markPaid ? paymentSummary({ provider, reference, note }) : null,
  });

  if (!result.ok) {
    if (result.reason === "no_free_spot") {
      throw new Error("That trip has no free spot right now");
    }
    if (result.reason === "trip_missing") throw new Error("Trip not found");
    throw new Error(
      "That signup cannot be reinstated - it is already active, or the member has a newer signup on this trip",
    );
  }

  refresh(result.tripId);
}

/** How long the same scope is refused a second send. */
const RESEND_COOLDOWN = "10 minutes";

/**
 * Emails every member with an outstanding balance in the chosen scope - the
 * second of the only two emails this app sends.
 *
 * One message per member, never a shared To or CC: a single header would hand
 * every recipient the address of everyone else who has not paid.
 *
 * An identical scope sent inside the cooldown is refused, which covers a
 * resubmitted form, a retried request, and a second treasurer in another tab.
 * The cooldown reads audit_events rather than in-memory state, so it holds
 * across serverless instances. The count the treasurer previewed is re-checked
 * too: if the recipient set moved, the send is refused rather than widened.
 */
export async function sendUnpaidRemindersAction(formData: FormData): Promise<void> {
  const actor = await requireCapability("managePayments");

  const tripId = text(formData, "tripId") || null;
  const includeLapsed = formData.get("includeLapsed") !== null;
  const expected = Number(formData.get("expectedCount") ?? "-1");

  const scopeKey = `${tripId ?? "all-live"}:${includeLapsed ? "with-lapsed" : "live-only"}`;

  const recipients = await listUnpaidRecipients(tripId, includeLapsed);

  if (recipients.length === 0) throw new Error("Nobody in that scope owes money");
  if (recipients.length > MAX_BATCH) {
    throw new Error(
      `That scope covers more than ${MAX_BATCH} members. Send it one trip at a time.`,
    );
  }
  if (expected !== recipients.length) {
    throw new Error(
      `The recipient list changed since you previewed it (${expected} then, ${recipients.length} now). Preview again before sending.`,
    );
  }

  // The audit row is claimed BEFORE a single message goes out, in one
  // conditional insert, so the cooldown covers the send itself: a second submit
  // arriving mid-send finds the row already there and returns nothing.
  const claim = await execute<{ id: string }>(
    `insert into audit_events (actor_board_user_id, action, entity_type, entity_id, data)
     select $1::uuid, 'payments.outstanding_batch', 'trip', $2::uuid, $3::jsonb
      where not exists (
        select 1 from audit_events
         where action = 'payments.outstanding_batch'
           and data->>'scopeKey' = $4
           and created_at > now() - interval '${RESEND_COOLDOWN}'
      )
     returning id`,
    [
      actor.boardUserId,
      tripId,
      JSON.stringify({
        scopeKey,
        includeLapsed,
        recipientCount: recipients.length,
        status: "started",
      }),
      scopeKey,
    ],
  );

  if (claim.length === 0) {
    throw new Error(
      `That same batch was sent within the last ${RESEND_COOLDOWN}. Wait, or narrow the scope, before sending again.`,
    );
  }

  // One failure is one member who did not get their reminder, not a reason to
  // abandon the rest. Failures are named so they can be chased individually.
  const failed: string[] = [];
  let sent = 0;

  for (const recipient of recipients) {
    try {
      await sendEmail(
        outstandingBalanceEmail({
          to: recipient.email,
          firstName: recipient.first_name,
          tripTitle: recipient.trip_title,
          amountCents: recipient.amount_cents,
          deadline: recipient.payment_deadline_at,
          payToken: recipient.pay_token,
          lapsed: recipient.lapsed,
        }),
      );
      sent += 1;
    } catch (error) {
      console.error("outstanding balance email failed", recipient.email, error);
      failed.push(recipient.email);
    }
  }

  await execute(
    `update audit_events set data = data || $2::jsonb where id = $1`,
    [
      claim[0].id,
      JSON.stringify({
        status: "finished",
        sent,
        failed: failed.length,
        failedRecipients: failed,
      }),
    ],
  );

  refresh(tripId);
  redirect(`/admin/payments?mailSent=${sent}&mailFailed=${failed.length}`);
}
