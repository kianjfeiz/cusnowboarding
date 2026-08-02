import { SignJWT, jwtVerify } from "jose";

/**
 * The drop-night typing challenge.
 *
 * A plain button rewards whatever clicks fastest, which is a script. Requiring
 * a short phrase to be typed makes the race a human one and removes the value
 * of automating it entirely - a bot that can read the phrase is a lot more work
 * than a bot that can click.
 *
 * The phrase is the board's own, set on the trip. It used to be five words
 * drawn at random here; the security property never came from the randomness
 * (the phrase is shown on screen either way) but from the token being signed
 * and bound to one member and one trip. Letting the board choose the words
 * means the phrase can be announced at a meeting or printed on a flyer.
 *
 * The phrase is carried in a signed token issued when the trip page renders, so
 * at 8:00:00 the claim still verifies in process: one HMAC check, no database
 * read, no extra round trip. Nothing about this touches the claim statement.
 *
 * Honest limit: the client-side paste blocking is a speed bump, not a control.
 * Someone determined can retype anything a script feeds them. What actually
 * holds is the signed phrase (it cannot be reused for another member or trip)
 * plus the one-signup-per-member index.
 */

const CHALLENGE_TTL = "12h";
const AUDIENCE = "claim-challenge";

function secret(): Uint8Array {
  const value = process.env.MEMBER_JWT_SECRET;
  if (!value) throw new Error("MEMBER_JWT_SECRET is not set");
  return new TextEncoder().encode(value);
}

export interface Challenge {
  phrase: string;
  token: string;
}

/**
 * Bound to both the trip and the member: a phrase issued to one person for one
 * trip cannot be handed to someone else, or replayed against another drop.
 */
export async function issueChallenge(
  tripId: string,
  memberId: string,
  phrase: string,
): Promise<Challenge> {
  const token = await new SignJWT({ p: phrase, t: tripId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(memberId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(CHALLENGE_TTL)
    .sign(secret());

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
    ({ payload } = await jwtVerify(token, secret(), {
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
