import { SignJWT, jwtVerify } from "jose";
import { memberJwtSecret } from "@/lib/auth/member-session";

/**
 * The drop-night typing challenge. A plain button rewards whatever clicks
 * fastest, which is a script; typing a short phrase makes the race a human one.
 *
 * The phrase is the board's own, set on the trip. The security property comes
 * not from the words (they are shown on screen) but from the token being signed
 * and bound to one member and one trip. It is issued when the trip page
 * renders, so the claim verifies it in process: one HMAC check, no database
 * read. Client-side paste blocking is a speed bump, not a control.
 */

const CHALLENGE_TTL = "12h";
const AUDIENCE = "claim-challenge";

/**
 * Bound to both the trip and the member: a phrase issued to one person for one
 * trip cannot be handed to someone else, or replayed against another drop.
 */
export async function issueChallenge(
  tripId: string,
  memberId: string,
  phrase: string,
): Promise<{ phrase: string; token: string }> {
  const token = await new SignJWT({ p: phrase, t: tripId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(memberId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(CHALLENGE_TTL)
    .sign(memberJwtSecret());

  return { phrase, token };
}

export type ChallengeVerdict = "ok" | "mismatch" | "expired" | "invalid";

/** Collapses whitespace and case so a stray double space is not a lost spot. */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function verifyChallenge(
  token: string | undefined,
  typed: string | undefined,
  tripId: string,
  memberId: string,
): Promise<ChallengeVerdict> {
  if (!token || typeof typed !== "string") return "invalid";

  let payload;
  try {
    ({ payload } = await jwtVerify(token, memberJwtSecret(), {
      algorithms: ["HS256"],
      audience: AUDIENCE,
    }));
  } catch (error) {
    return error instanceof Error && error.name === "JWTExpired" ? "expired" : "invalid";
  }

  if (payload.sub !== memberId) return "invalid";
  if (payload.t !== tripId) return "invalid";
  if (typeof payload.p !== "string") return "invalid";

  return normalize(payload.p) === normalize(typed) ? "ok" : "mismatch";
}
