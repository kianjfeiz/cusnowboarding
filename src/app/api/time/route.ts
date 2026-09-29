import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server clock, sampled by the claim panel to correct a skewed device clock.
 * Display only: the claim statement checks `signup_opens_at <= now()` itself.
 */
export function GET() {
  return NextResponse.json(
    { now: Date.now() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
