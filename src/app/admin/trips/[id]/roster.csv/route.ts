import { NextResponse } from "next/server";
import { currentActor } from "../../../_lib/actor";
import { csvDollars, csvResponse, csvTime as at } from "../../../_lib/csv";
import { can } from "@/lib/auth/authz";
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
    // A comped board rider has to count as a body on the bus without reading
    // as a member who paid nothing.
    "board_seat",
    "amount_usd",
    "paid_at",
    "payment_deadline",
    "paid_offline",
    "waitlist_position",
    "claimed_at",
  ];

  const rows = roster.map((row) => [
    row.spot_number,
    row.claim_seq,
    STATUS_LABELS[effectiveStatus(row, now)],
    row.first_name,
    row.last_name,
    row.email,
    row.phone,
    row.is_club_member ? "yes" : "no",
    row.board_seat ? "yes" : "no",
    csvDollars(row.amount_cents),
    at(row.paid_at),
    at(row.payment_deadline_at),
    row.paid_offline ? "yes" : "no",
    row.waitlist_position,
    at(row.claimed_at),
  ]);

  return csvResponse(`${trip.slug}-roster.csv`, header, rows);
}
