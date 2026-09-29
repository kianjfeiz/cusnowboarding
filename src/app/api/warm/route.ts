import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Must match the claim route, or warming the wrong region achieves nothing. */
export const preferredRegion = "iad1";

/**
 * Opens a database connection ahead of a drop so the first real claimer does
 * not pay for a cold start plus a TLS handshake.
 *
 * Ping this a couple of minutes before signups open. It is intentionally cheap
 * and unauthenticated - it reveals nothing and does no work beyond `select 1`.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await pool.query("select 1");
    return NextResponse.json(
      { ok: true, dbLatencyMs: Date.now() - startedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
