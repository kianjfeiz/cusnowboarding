import { execute } from "@/lib/db";
import {
  auditInTransaction,
  keepCounterAtLeast,
  nextSpot,
  releaseLapsedHolds,
  withTripLock,
} from "@/lib/roster/promotion";

/**
 * Putting a released rider back on a trip.
 *
 * The case this exists for: the treasurer finds the money after the hold has
 * already lapsed. Nothing else can give the spot back - the claim only creates
 * new rows, promotion only accepts a waitlisted one, and recording a payment
 * only accepts a held one. Same cold path and same lock order as promotion: a
 * treasurer reinstating while a coordinator promotes is an ordinary Tuesday.
 */

export interface ReinstateOptions {
  /** The money is already in hand, so land on `paid` rather than a new hold. */
  markPaid?: boolean;
  /**
   * Where that money came from, written as a payments row so a spot reinstated
   * as paid has a record behind it. Only read when markPaid. Validation belongs
   * with the form, in admin/_lib/payment-queries.
   */
  provider?: string;
  reference?: string | null;
  note?: string | null;
  /** One-line summary for signups.offline_note, for readers that predate payments rows. */
  offlineNote?: string | null;
}

export type ReinstateResult =
  | { ok: true; tripId: string; spotNumber: number; status: "held" | "paid" }
  | { ok: false; reason: "not_reinstatable" | "no_free_spot" | "trip_missing" };

export async function reinstateSignup(
  signupId: string,
  boardUserId: string | null,
  opts: ReinstateOptions = {},
): Promise<ReinstateResult> {
  if (!signupId) return { ok: false, reason: "not_reinstatable" };

  const markPaid = opts.markPaid === true;
  const offlineNote = markPaid ? (opts.offlineNote?.trim() || null) : null;
  const provider = markPaid ? (opts.provider?.trim() || "fusion") : null;
  const reference = markPaid ? (opts.reference?.trim() || null) : null;
  const note = markPaid ? (opts.note?.trim() || null) : null;

  // Read before the lock only to learn which trip to lock. The guarded UPDATE
  // below re-checks the status once the lock is held.
  const [signup] = await execute<{ trip_id: string; member_id: string; status: string }>(
    `select trip_id, member_id, status::text as status from signups
      where id = $1 and status in ('expired','cancelled','refunded')`,
    [signupId],
  );
  if (!signup) return { ok: false, reason: "not_reinstatable" };
  const tripId = signup.trip_id;

  return withTripLock<ReinstateResult>(tripId, async (client, trip) => {
    if (!trip) return { ok: false, reason: "trip_missing" };

    await releaseLapsedHolds(client, tripId);

    // The member may have claimed again while this row sat expired.
    // `signups_one_active_per_member` would reject the write anyway; catching
    // it here turns a raw 23505 into an answer the caller can render.
    const { rows: activeRows } = await client.query(
      `select 1 from signups
        where trip_id = $1 and member_id = $2 and id <> $3
          and status in ('held','paid','waitlisted')
        limit 1`,
      [tripId, signup.member_id, signupId],
    );
    if (activeRows.length > 0) return { ok: false, reason: "not_reinstatable" };

    // Capacity is a target: a full trip takes them back past it.
    const spot = await nextSpot(client, tripId, trip.capacity);

    // `released_at` and `release_reason` are cleared because they are what every
    // reader uses to tell a live signup from a dead one. The release is not
    // lost: the audit event records what the row was before it came back.
    // Every payment on the books was recorded by a human, so `paid_offline`
    // follows the decision rather than the source.
    const { rows: updated } = await client.query<{ paid_at: Date | null; amount_cents: number }>(
      `update signups
          set status              = case when $4::boolean then 'paid'::signup_status
                                                          else 'held'::signup_status end,
              spot_number         = $2,
              waitlist_position   = null,
              payment_deadline_at = now() + make_interval(hours => $3::int),
              paid_at             = case when $4::boolean then now() else null end,
              paid_offline        = $4::boolean,
              offline_note        = case when $4::boolean then $5::text else offline_note end,
              released_at         = null,
              release_reason      = null,
              updated_at          = now()
        where id = $1 and status in ('expired','cancelled','refunded')
        returning paid_at, amount_cents`,
      [signupId, spot, trip.payment_window_hours, markPaid, offlineNote],
    );
    if (updated.length === 0) return { ok: false, reason: "not_reinstatable" };

    // The same record recordPayment writes: a `paid` signup with no payments
    // row behind it is what makes reconciliation impossible later.
    if (markPaid) {
      await client.query(
        `insert into payments (signup_id, provider, reference, amount_cents, status,
                               paid_at, note, recorded_by)
         values ($1, $2, $3, $4, 'paid', $5, $6, $7)`,
        [
          signupId,
          provider,
          reference,
          updated[0].amount_cents,
          updated[0].paid_at,
          note,
          boardUserId,
        ],
      );
    }

    // The row keeps its old arrival number, which may sit below the spot it now takes.
    await keepCounterAtLeast(client, tripId, spot);

    await auditInTransaction(client, boardUserId, "signup.reinstate", "signup", signupId, {
      tripId,
      memberId: signup.member_id,
      from: signup.status,
      to: markPaid ? "paid" : "held",
      spotNumber: spot,
      provider,
      reference,
      note,
    });

    return { ok: true, tripId, spotNumber: spot, status: markPaid ? "paid" : "held" };
  });
}
