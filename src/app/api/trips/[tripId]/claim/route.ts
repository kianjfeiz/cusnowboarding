import { NextResponse, after, type NextRequest } from "next/server";
import { pool } from "@/lib/db";
import {
  claimSpot,
  generatePayToken,
  releaseUnusedSequence,
  type ClaimResult,
} from "@/lib/claims/claim";
import { MEMBER_COOKIE, verifyMemberToken } from "@/lib/auth/member-session";
import { verifyChallenge } from "@/lib/claims/challenge";
import { clientIp, userAgent } from "@/lib/request";

/**
 * THE DROP-TIME HOT PATH.
 *
 * Everything in this handler before the claim is in-process work measured in
 * microseconds. There is exactly one database round trip, and nothing else -
 * no session lookup, no rate-limit check, no feature flag, no analytics call.
 * Anything added here is paid by every claimer while the trip row lock is
 * contended, so new work belongs in `after()` or somewhere else entirely.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Must sit in the same region as the database. A cross-region function pays
 * the round trip while holding the trip row lock, which turns a 100-person
 * burst into a multi-second tail. Change this only alongside the database.
 */
export const preferredRegion = "iad1";

const OUTCOME_STATUS: Record<ClaimResult["outcome"], number> = {
  held: 200,
  waitlisted: 200,
  duplicate: 200,
  not_open: 409,
  unverified: 401,
  not_member: 403,
  full: 409,
  error: 500,
};

/**
 * Entrants are told only that their entry was received - the outcome is the
 * board's to publish, later, all at once. That rule holds for the response
 * BODY, not just the UI: anything serialized here is one devtools tab away,
 * and held/waitlisted plus a waitlist number is exactly the scoreboard the
 * drop is designed not to be. A successful claim can only happen while
 * signups are open, and results release closes signups, so every one of
 * these three outcomes is by construction pre-release. The full outcome
 * still lands in claim_attempts for the board's drop log, and the member
 * hears it by email when results go out.
 */
const RECEIVED: ReadonlySet<ClaimResult["outcome"]> = new Set([
  "held",
  "waitlisted",
  "duplicate",
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const startedAt = Date.now();
  const { tripId } = await params;

  // In-process HMAC check. No database, no network.
  const token = request.cookies.get(MEMBER_COOKIE)?.value;
  const session = token ? await verifyMemberToken(token) : null;

  if (!session) {
    return NextResponse.json({ outcome: "unverified" }, { status: 401 });
  }

  // The typed phrase. Also an in-process HMAC check against a token issued when
  // the page rendered, so this costs no round trip at drop time.
  const body = (await request.json().catch(() => null)) as {
    challengeToken?: string;
    typed?: string;
  } | null;

  const verdict = await verifyChallenge(
    body?.challengeToken,
    body?.typed,
    tripId,
    session.memberId,
  );

  if (verdict !== "ok") {
    return NextResponse.json({ outcome: "challenge", reason: verdict }, { status: 400 });
  }

  let result: ClaimResult;
  try {
    result = await claimSpot(
      pool,
      tripId,
      session.memberId,
      generatePayToken(),
      session.tokenVersion,
    );
  } catch (error) {
    console.error("claim failed", error);
    result = { outcome: "error" };
  }

  const latencyMs = Date.now() - startedAt;

  // Everything below is off the response path.
  after(async () => {
    if (result.consumedSeq !== undefined) {
      // A counter value was burned without producing a row. Give it back so the
      // trip does not silently run one spot short.
      await releaseUnusedSequence(pool, tripId, result.consumedSeq).catch(() => {});
    }

    await pool
      .query(
        `insert into claim_attempts
           (trip_id, member_id, result, claim_seq, ip, user_agent, latency_ms)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tripId,
          session.memberId,
          result.outcome,
          result.signup?.claimSeq ?? null,
          clientIp(request),
          userAgent(request),
          latencyMs,
        ],
      )
      .catch(() => {});
  });

  if (RECEIVED.has(result.outcome)) {
    return NextResponse.json({ outcome: "received" }, { status: 200 });
  }

  return NextResponse.json(
    { outcome: result.outcome },
    { status: OUTCOME_STATUS[result.outcome] },
  );
}
