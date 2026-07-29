import { NextResponse } from "next/server";
import { currentActor } from "../../../_lib/actor";
import { can } from "@/lib/authz";
import {
  STATUS_LABELS,
  effectiveStatus,
  getRoster,
  getTripSummary,
} from "../../../_lib/queries";

export const dynamic = "force-dynamic";

/**
 * The roster as a file, because the resort wants a manifest and the bus driver
 * wants a headcount, and neither of them is going to log in.
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor();
  if (!can(actor, "viewRosters")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const [trip, roster] = await Promise.all([getTripSummary(id), getRoster(id)]);
  if (!trip) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const now = Date.now();
  const header = [
    "spot",
    "arrival_order",
    "status",
    "first_name",
    "last_name",
    "email",
    "phone",
    "dues_paid",
    "amount_usd",
    "paid_at",
    "payment_deadline",
    "paid_offline",
    "waitlist_position",
    "claimed_at",
  ];

  const lines = [header.map(csvCell).join(",")];

  for (const row of roster) {
    lines.push(
      [
        row.spot_number ?? "",
        row.claim_seq,
        STATUS_LABELS[effectiveStatus(row, now)],
        row.first_name,
        row.last_name,
        row.email,
        row.phone ?? "",
        row.is_club_member ? "yes" : "no",
        (row.amount_cents / 100).toFixed(2),
        at(row.paid_at),
        at(row.payment_deadline_at),
        row.paid_offline ? "yes" : "no",
        row.waitlist_position ?? "",
        at(row.claimed_at),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const filename = `${trip.slug}-roster.csv`;

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
