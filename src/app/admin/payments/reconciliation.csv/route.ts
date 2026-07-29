import { NextResponse } from "next/server";
import { can } from "@/lib/authz";
import { currentActor } from "../../_lib/actor";
import {
  PAYMENT_STATE_LABELS,
  filterPaymentLines,
  listPaymentLines,
  listPaymentTripOptions,
  paidVia,
  parsePaymentFilter,
  paymentState,
  resolveTripId,
} from "../../_lib/payment-queries";

export const dynamic = "force-dynamic";

/**
 * The filtered payment table as a file, for sitting next to the Fusion export.
 * Amounts are written in dollars because that is what the export uses; the
 * cents-to-dollars conversion happens once, here, on the way out.
 */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Excel and Sheets both treat a leading =, +, - or @ as a formula.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

const DENVER: Intl.DateTimeFormatOptions = {
  timeZone: "America/Denver",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

const at = (value: Date | null) =>
  value ? new Date(value).toLocaleString("en-US", DENVER) : "";

const dollars = (cents: number) => (cents / 100).toFixed(2);

export async function GET(request: Request) {
  const actor = await currentActor();
  if (!can(actor, "managePayments")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const filter = parsePaymentFilter(params.get("status"));
  const trips = await listPaymentTripOptions();
  const tripId = resolveTripId(params.get("trip"), trips);

  const now = Date.now();
  const rows = filterPaymentLines(await listPaymentLines(tripId), filter, now);

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

  const lines = [header.map(csvCell).join(",")];

  for (const row of rows) {
    const via = paidVia(row);
    lines.push(
      [
        row.trip_title,
        row.trip_status,
        row.spot_number ?? "",
        row.first_name,
        row.last_name,
        row.email,
        PAYMENT_STATE_LABELS[paymentState(row, now)],
        dollars(row.amount_cents),
        via.label,
        // The reference is what a Fusion line is matched on, so it gets its own
        // column rather than being folded into the "paid via" summary.
        row.payment_reference ?? "",
        row.payment_note ?? row.offline_note ?? "",
        at(row.paid_at),
        at(row.payment_deadline_at),
        at(row.claimed_at),
        row.payment_status ?? "",
        dollars(row.refunded_cents),
        row.signup_id,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const slug = tripId ? (rows[0]?.trip_slug ?? "trip") : "all-trips";
  const filename = `payments-${slug}-${filter}.csv`;

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
