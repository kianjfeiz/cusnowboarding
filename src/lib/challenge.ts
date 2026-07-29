import { randomInt } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

/**
 * The drop-night typing challenge.
 *
 * A plain button rewards whatever clicks fastest, which is a script. Requiring
 * a short phrase to be typed makes the race a human one and removes the value
 * of automating it entirely - a bot that can read the phrase is a lot more work
 * than a bot that can click.
 *
 * The phrase is carried in a signed token issued when the trip page renders, so
 * at 8:00:00 the claim still verifies in process: one HMAC check, no database
 * read, no extra round trip. Nothing about this touches the claim statement.
 *
 * Honest limit: the client-side paste blocking is a speed bump, not a control.
 * Someone determined can retype anything a script feeds them. What actually
 * holds is the signed phrase (it cannot be guessed ahead of time or reused for
 * another member) plus the one-signup-per-member index.
 */

/**
 * Short, unambiguous, easy to type fast. Deliberately no homophones, no
 * doubled letters that invite typos, nothing that reads as instruction.
 */
const WORDS = [
  "alpine", "anchor", "aspen", "basin", "birch", "bluff", "boulder", "branch",
  "bridge", "canyon", "carve", "cedar", "chute", "cirque", "cliff", "cobalt",
  "copper", "cornice", "creek", "crest", "crystal", "drift", "eagle", "ember",
  "falcon", "fern", "flint", "forest", "frost", "glacier", "granite", "gravel",
  "harbor", "hazel", "hollow", "ivory", "juniper", "kernel", "lantern", "ledge",
  "lichen", "lodge", "lumen", "marble", "meadow", "mesa", "moraine", "narrow",
  "nickel", "north", "onyx", "orbit", "outpost", "pebble", "pine", "pivot",
  "plateau", "powder", "prairie", "quartz", "quiver", "ranger", "ridge", "river",
  "saddle", "sagebrush", "sapling", "shale", "sierra", "silver", "slate", "slope",
  "spruce", "stone", "summit", "sunset", "talus", "timber", "trail", "tundra",
  "valley", "vertex", "walnut", "willow", "winter", "zenith",
];

const WORD_COUNT = 5;
const CHALLENGE_TTL = "12h";
const AUDIENCE = "claim-challenge";

function secret(): Uint8Array {
  const value = process.env.MEMBER_JWT_SECRET;
  if (!value) throw new Error("MEMBER_JWT_SECRET is not set");
  return new TextEncoder().encode(value);
}

export function generatePhrase(): string {
  /**
   * Partial Fisher-Yates, so no word repeats. A phrase like "pebble ... pebble"
   * is measurably slower and more error-prone to type under pressure, and on
   * drop night a typo is a lost spot.
   *
   * randomInt is rejection-sampled, so the draw stays uniform - a biased phrase
   * would be guessable, and a guessable phrase is a scriptable one.
   */
  const pool = [...WORDS];
  const picked: string[] = [];

  for (let i = 0; i < WORD_COUNT; i++) {
    const index = randomInt(i, pool.length);
    [pool[i], pool[index]] = [pool[index], pool[i]];
    picked.push(pool[i]);
  }

  return picked.join(" ");
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
  phrase: string = generatePhrase(),
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
