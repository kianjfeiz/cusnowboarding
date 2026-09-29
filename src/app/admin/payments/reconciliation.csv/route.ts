import { NextResponse } from "next/server";
import { can } from "@/lib/auth/authz";
import { currentActor } from "../../_lib/actor";
import { csvDollars as dollars, csvResponse, csvTime as at } from "../../_lib/csv";
import {
  PAYMENT_STATE_LABELS,
  listPaymentLines,
  listPaymentTrips,
  paidVia,
  paymentState,
  resolveTripId,
} from "../../_lib/payment-queries";

export const dynamic = "force-dynamic";

/**
 * The whole ledger for one trip or all of them, for sitting next to the Fusion
 * export - which is why amounts are written in dollars.
 */
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!can(actor, "managePayments")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const tripId = resolveTripId(
    new URL(request.url).searchParams.get("trip"),
    await listPaymentTrips(),
  );

  const now = Date.now();
  const rows = await listPaymentLines(tripId);

  const header = [
    "trip",
    "trip_status",
    "spot",
    "first_name",
    "last_name",
    "email",
    "status",
    "amount_usd",
    "paid_via",
    "reference",
    "note",
    "paid_at",
    "payment_deadline",
    "claimed_at",
    "payment_status",
    "refunded_usd",
    "signup_id",
  ];

  const body = rows.map((row) => [
    row.trip_title,
    row.trip_status,
    row.spot_number,
    row.first_name,
    row.last_name,
    row.email,
    PAYMENT_STATE_LABELS[paymentState(row, now)],
    dollars(row.amount_cents),
    paidVia(row).label,
    // The reference is what a Fusion line is matched on, so it gets its own
    // column rather than being folded into the "paid via" summary.
    row.payment_reference,
    row.payment_note ?? row.offline_note,
    at(row.paid_at),
    at(row.payment_deadline_at),
    at(row.claimed_at),
    row.payment_status,
    dollars(row.refunded_cents),
    row.signup_id,
  ]);

  const slug = tripId ? (rows[0]?.trip_slug ?? "trip") : "all-trips";
  return csvResponse(`payments-${slug}-all.csv`, header, body);
}
