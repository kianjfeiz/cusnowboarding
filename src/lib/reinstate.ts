import { pool } from "@/lib/db";
import { releaseLapsedHolds } from "@/lib/promotion";

/**
 * Putting a released rider back on a trip.
 *
 * The case this exists for: the treasurer finds the money after the hold has
 * already lapsed. Nothing else in the app can give the spot back - the claim
 * statement only ever creates new rows, promotion only accepts a waitlisted one,
 * and recording a payment only accepts a held one. The board's only recourse
 * was psql, on the money path, by hand.
 *
 * Structurally this is the sibling of promoteFromWaitlist: same cold path, same
 * short explicit transaction, and deliberately the same lock order - the trip
 * row is taken `for update` before anything else is read or written. Two
 * different orders across two transactions that both touch trips and signups is
 * how a deadlock gets built, and a treasurer reinstating while a coordinator
 * promotes on the same trip is an entirely ordinary Tuesday.
 */

export type ReinstateFailure = "not_reinstatable" | "no_free_spot" | "trip_missing";

export interface ReinstateOptions {
  /** The money is already in hand, so land on `paid` rather than a new hold. */
  markPaid?: boolean;
  /**
   * Where that money came from. Written as a payments row, the same record
   * recordPayment leaves, so a spot reinstated as paid is not a `paid` signup
   * with nothing behind it. Only read when markPaid.
   *
   * Not narrowed to the provider list here: the column is plain text and the
   * validation belongs with the form, in admin/_lib/payment-queries.
   */
  provider?: string;
  reference?: string | null;
  note?: string | null;
  /** One-line summary for signups.offline_note, for readers that predate payments rows. */
  offlineNote?: string | null;
}

export type ReinstateResult =
  | {
      ok: true;
      signupId: string;
      tripId: string;
      spotNumber: number;
      status: "held" | "paid";
      paymentDeadlineAt: Date;
      amountCents: number;
      payToken: string;
      tripTitle: string;
      memberEmail: string;
      memberFirstName: string;
      memberName: string;
    }
  | { ok: false; reason: ReinstateFailure };

/** The statuses a signup can come back from. */
const REINSTATABLE = ["expired", "cancelled", "refunded"];

export async function reinstateSignup(
  signupId: string,
  boardUserId: string | null,
  opts: ReinstateOptions = {},
): Promise<ReinstateResult> {
  if (!signupId) return { ok: false, reason: "not_reinstatable" };

  const markPaid = opts.markPaid === true;
  // Nothing observes money any more, so every payment on the books was recorded
  // by a human. `paid_offline` follows the decision rather than the source.
  const paidOffline = markPaid;
  const offlineNote = markPaid ? (opts.offlineNote?.trim() || null) : null;
  const provider = markPaid ? (opts.provider?.trim() || "fusion") : null;
  const reference = markPaid ? (opts.reference?.trim() || null) : null;
  const note = markPaid ? (opts.note?.trim() || null) : null;

  const client = await pool.connect();

  try {
    await client.query("begin");

    const { rows: signupRows } = await client.query<{
      trip_id: string;
      member_id: string;
      status: string;
    }>(
      `select trip_id, member_id, status::text as status from signups where id = $1`,
      [signupId],
    );

    const signup = signupRows[0];
    if (!signup || !REINSTATABLE.includes(signup.status)) {
      await client.query("rollback");
      return { ok: false, reason: "not_reinstatable" };
    }

    // Same lock, same order, same reason as promoteFromWaitlist: whoever holds
    // the trip row decides who gets the next free spot number.
    const { rows: tripRows } = await client.query<{
      capacity: number;
      payment_window_hours: number;
    }>(`select capacity, payment_window_hours from trips where id = $1 for update`, [
      signup.trip_id,
    ]);

    if (tripRows.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "trip_missing" };
    }
    const { capacity, payment_window_hours: windowHours } = tripRows[0];

    /**
     * A lapsed hold still physically occupies its spot_number until something
     * releases it, so without this the trip would look full here while the
     * treasurer's screen reported a free spot.
     */
    await releaseLapsedHolds(client, signup.trip_id);

    /**
     * The member may have come back and claimed again while this row sat
     * expired. `signups_one_active_per_member` would reject the write anyway;
     * catching it here turns a raw 23505 into an answer the caller can render.
     */
    const { rows: activeRows } = await client.query<{ id: string }>(
      `select id from signups
        where trip_id = $1 and member_id = $2 and id <> $3
          and status in ('held','paid','waitlisted')
        limit 1`,
      [signup.trip_id, signup.member_id, signupId],
    );
    if (activeRows.length > 0) {
      await client.query("rollback");
      return { ok: false, reason: "not_reinstatable" };
    }

    // Lowest unoccupied spot number, so the roster stays dense. Never a
    // count(*) against capacity - that reads a snapshot and oversells.
    const { rows: freeRows } = await client.query<{ spot: number }>(
      `select gs as spot
         from generate_series(1, $2) gs
        where not exists (
          select 1 from signups s
           where s.trip_id = $1 and s.spot_number = gs
        )
        order by gs
        limit 1`,
      [signup.trip_id, capacity],
    );

    if (freeRows.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "no_free_spot" };
    }
    const spot = freeRows[0].spot;

    /**
     * `released_at` and `release_reason` are cleared because the row is live
     * again and those two columns are what every reader uses to tell a live
     * signup from a dead one. The release is not lost - the audit event below
     * records what the row was before it came back.
     */
    const { rows: updated } = await client.query<{
      id: string;
      spot_number: number;
      payment_deadline_at: Date;
      paid_at: Date | null;
      amount_cents: number;
      pay_token: string;
      email: string;
      first_name: string;
      last_name: string;
      trip_title: string;
    }>(
      `update signups s
          set status              = case when $4::boolean then 'paid'::signup_status
                                                          else 'held'::signup_status end,
              spot_number         = $2,
              waitlist_position   = null,
              payment_deadline_at = now() + make_interval(hours => $3::int),
              paid_at             = case when $4::boolean then now() else null end,
              paid_offline        = $5::boolean,
              offline_note        = case when $5::boolean then $6::text else s.offline_note end,
              released_at         = null,
              release_reason      = null,
              updated_at          = now()
         from members m, trips t
        where s.id = $1 and m.id = s.member_id and t.id = s.trip_id
          and s.status in ('expired','cancelled','refunded')
        returning s.id, s.spot_number, s.payment_deadline_at, s.paid_at, s.amount_cents,
                  s.pay_token, m.email::text as email, m.first_name, m.last_name,
                  t.title as trip_title`,
      [signupId, spot, windowHours, markPaid, paidOffline, offlineNote],
    );

    if (updated.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "not_reinstatable" };
    }

    /**
     * The same record recordPayment writes. Reinstating as paid is the treasurer
     * saying the money is in hand, and a `paid` signup with no payments row
     * behind it is exactly what makes reconciliation impossible later.
     */
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

    await client.query(
      `insert into audit_events (actor_board_user_id, action, entity_type, entity_id, data)
       values ($1, 'signup.reinstate', 'signup', $2, $3::jsonb)`,
      [
        boardUserId,
        signupId,
        JSON.stringify({
          tripId: signup.trip_id,
          memberId: signup.member_id,
          from: signup.status,
          to: markPaid ? "paid" : "held",
          spotNumber: spot,
          provider,
          reference,
          note,
        }),
      ],
    );

    await client.query("commit");

    const row = updated[0];
    return {
      ok: true,
      signupId: row.id,
      tripId: signup.trip_id,
      spotNumber: row.spot_number,
      status: markPaid ? "paid" : "held",
      paymentDeadlineAt: row.payment_deadline_at,
      amountCents: row.amount_cents,
      payToken: row.pay_token,
      tripTitle: row.trip_title,
      memberEmail: row.email,
      memberFirstName: row.first_name,
      memberName: `${row.first_name} ${row.last_name}`,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
