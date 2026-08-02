"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { execute } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { outstandingBalanceEmail, reinstatedEmail } from "@/lib/email/templates";
import { reinstateSignup } from "@/lib/reinstate";
import { requireCapability } from "../_lib/actor";
import { recordAudit } from "../_lib/audit";
import { paymentSummary } from "../_lib/payment-queries";
import {
  parsePaymentProvider,
  requiresReference,
  type PaymentProvider,
} from "@/lib/payment-providers";
import { MAX_BATCH, batchScopeKey, listUnpaidRecipients } from "./unpaid";

function refresh(tripId: string | null): void {
  revalidatePath("/admin/payments");
  revalidatePath("/admin/trips");
  revalidatePath("/admin");
  if (tripId) revalidatePath(`/admin/trips/${tripId}`);
}

// ---------------------------------------------------------------------------
// Recording a payment
// ---------------------------------------------------------------------------

export interface RecordPaymentInput {
  provider?: string | null;
  /** Fusion transaction id, Venmo note, cheque number - anything findable. */
  reference?: string | null;
  /** Defaults to what the spot costs; the club does not take part payments. */
  amountCents?: number | null;
  note?: string | null;
}

/**
 * Marks a spot paid and records where the money came from.
 *
 * The app never sees the money. Fusion has no API, so the treasurer reconciles
 * the portal's export against this screen and records the result by hand; the
 * `payments` row is the durable answer to "why does this say paid", and without
 * it there is nothing for next term's treasurer to reconcile against.
 *
 * A reference is required for Fusion because the transaction id is the only
 * thing that ties this row to a line in that export. Cash has no equivalent, so
 * for the other providers a note stands in - one or the other, never neither.
 */
export async function recordPayment(
  signupId: string,
  input: RecordPaymentInput,
): Promise<void> {
  const actor = await requireCapability("managePayments");

  if (!signupId) throw new Error("Signup not found");

  const provider: PaymentProvider = parsePaymentProvider(input.provider);
  const reference = input.reference?.trim() || null;
  const note = input.note?.trim() || null;

  // Same predicate the treasurer's form labels itself from, so the field that
  // renders as required and the field that is actually refused stay the same one.
  if (requiresReference(provider) && !reference) {
    throw new Error("Record the Fusion transaction id so this can be reconciled later");
  }
  if (!reference && !note) {
    throw new Error("Record a reference or a note saying where the money came from");
  }

  const amountCents =
    typeof input.amountCents === "number" && Number.isFinite(input.amountCents)
      ? Math.round(input.amountCents)
      : null;

  /*
    One statement. The `and status = 'held'` guard lives inside the update
    rather than in a read-then-write, so two treasurers clicking at once cannot
    both stamp a paid_at; the loser matches no row and the insert, which selects
    from the update, writes nothing either. Both halves see the same
    transaction clock, so the payment's paid_at is the signup's paid_at.
  */
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
       select paid.id, $3, $4, coalesce($5::int, paid.amount_cents), 'paid',
              paid.paid_at, $6, $7::uuid
         from paid
       returning id, amount_cents
     )
     select paid.trip_id, paid.member_id, recorded.id as payment_id,
            recorded.amount_cents as recorded_cents
       from paid join recorded on true`,
    [
      signupId,
      paymentSummary({ provider, reference, note }),
      provider,
      reference,
      amountCents,
      note,
      actor.boardUserId,
    ],
  );

  const row = rows[0];
  if (!row) throw new Error("Only a held spot can be recorded as paid");

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
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

  refresh(row.trip_id);
}

export async function recordPaymentAction(formData: FormData): Promise<void> {
  await recordPayment(String(formData.get("signupId") ?? ""), {
    provider: String(formData.get("provider") ?? ""),
    reference: String(formData.get("reference") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
}

// ---------------------------------------------------------------------------
// Reinstating a released rider
// ---------------------------------------------------------------------------

/**
 * Puts a rider whose spot was released back on the trip.
 *
 * The transaction in lib/reinstate.ts is the guarantee - it takes the trip row
 * lock and re-checks that a spot is genuinely free, so nothing here can
 * oversell. What is left for this function is telling the member, which matters
 * because they believe they are off the trip.
 */
export async function reinstateSignupAction(formData: FormData): Promise<void> {
  const actor = await requireCapability("managePayments");

  const signupId = String(formData.get("signupId") ?? "");
  // Absent when the "money already received" checkbox is left alone.
  const markPaid = formData.get("markPaid") !== null;
  const provider = parsePaymentProvider(String(formData.get("provider") ?? ""));
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;

  if (markPaid && !reference && !note) {
    throw new Error("Record a reference or a note saying where the money came from");
  }

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

  // A reinstate nobody is told about is worthless - the member believes they
  // are off the trip, and if this landed as a hold there is a deadline running.
  try {
    await sendEmail(
      reinstatedEmail({
        to: result.memberEmail,
        firstName: result.memberFirstName,
        tripTitle: result.tripTitle,
        spotNumber: result.spotNumber,
        amountCents: result.amountCents,
        payToken: result.payToken,
        deadline: result.paymentDeadlineAt,
        alreadyPaid: result.status === "paid",
      }),
    );
  } catch (error) {
    console.error("reinstate notice failed", signupId, error);
  }

  refresh(result.tripId);
}

// ---------------------------------------------------------------------------
// Batch reminder to everyone with an outstanding balance
// ---------------------------------------------------------------------------

/** How long the same scope is refused a second send. */
const RESEND_COOLDOWN = "10 minutes";

const BATCH_ACTION = "payments.outstanding_batch";

/**
 * Emails every member with an outstanding balance in the chosen scope.
 *
 * One message per member, built and sent individually. Never a shared To or CC:
 * a single header would hand every recipient the address of everyone else who
 * has not paid, which is both a privacy breach and a list of who to gossip
 * about.
 *
 * Two things guard against mailing the club twice. The button disables itself
 * while the action is in flight, which covers the impatient double click; and
 * an identical scope sent inside the cooldown is refused outright, which covers
 * a resubmitted form, a retried request, and a second treasurer doing the same
 * job in another tab. The cooldown reads audit_events rather than any in-memory
 * state, so it holds across restarts and across serverless instances.
 *
 * The count the treasurer confirmed is submitted with the form and re-checked
 * here. If the recipient set moved between preview and send - a payment landed,
 * a hold lapsed into scope - the send is refused rather than quietly widened.
 */
export async function sendUnpaidRemindersAction(formData: FormData): Promise<void> {
  const actor = await requireCapability("managePayments");

  const rawTripId = String(formData.get("tripId") ?? "");
  const tripId = rawTripId || null;
  const includeLapsed = formData.get("includeLapsed") !== null;
  const expected = Number(formData.get("expectedCount") ?? "-1");

  const scopeKey = batchScopeKey(tripId, includeLapsed);

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

  /**
   * The audit row is claimed before a single message goes out, not written
   * afterwards, so the cooldown covers the send itself rather than only the
   * moment it finished. Conditional insert in one statement: a second submit
   * that arrives while the first is still working its way down the list finds
   * the row already there and returns nothing.
   */
  const claim = await execute<{ id: string }>(
    `insert into audit_events (actor_board_user_id, action, entity_type, entity_id, data)
     select $1::uuid, $2, 'trip', $3::uuid, $4::jsonb
      where not exists (
        select 1 from audit_events
         where action = $2
           and data->>'scopeKey' = $5
           and created_at > now() - interval '${RESEND_COOLDOWN}'
      )
     returning id`,
    [
      actor.boardUserId,
      BATCH_ACTION,
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
  const batchId = claim[0].id;

  /**
   * One failure is one member who did not get their reminder, not a reason to
   * abandon the other forty. Failures are counted and named so the treasurer
   * can chase them individually rather than resending to everyone.
   */
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
      batchId,
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
