import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/**
 * The member's verification credential.
 *
 * This is the mechanism that keeps drop-time latency at exactly one database
 * round trip. Verification (email, code, rate limits, provider calls) all
 * happens days earlier and is collapsed into a signed cookie. At 8:00:00 PM
 * the claim handler does an in-process HMAC verification - roughly 0.1ms, no
 * database read, no Redis read - and passes the member id straight into the
 * claim statement, which re-validates verification status for free because it
 * is already touching that row.
 */

export const MEMBER_COOKIE = "csc_member";
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export interface MemberSession {
  memberId: string;
  tokenVersion: number;
}

function secret(): Uint8Array {
  const value = process.env.MEMBER_JWT_SECRET;
  if (!value) throw new Error("MEMBER_JWT_SECRET is not set");
  return new TextEncoder().encode(value);
}

export async function issueMemberToken(session: MemberSession): Promise<string> {
  return new SignJWT({ tv: session.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.memberId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function verifyMemberToken(token: string): Promise<MemberSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.tv !== "number") return null;
    return { memberId: payload.sub, tokenVersion: payload.tv };
  } catch {
    return null;
  }
}

export function memberCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

/** Reads the verification cookie. Never touches the database. */
export async function getMemberSession(): Promise<MemberSession | null> {
  const store = await cookies();
  const token = store.get(MEMBER_COOKIE)?.value;
  if (!token) return null;
  return verifyMemberToken(token);
}

/**
 * Short-lived token for the "you are ready" email sent before a drop. Landing
 * on /ready re-issues the verification cookie, which is what makes verifying
 * on a laptop and racing on a phone work.
 */
const READY_AUDIENCE = "ready";

export async function issueReadyToken(session: MemberSession): Promise<string> {
  return new SignJWT({ tv: session.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.memberId)
    .setAudience(READY_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function verifyReadyToken(token: string): Promise<MemberSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
      audience: READY_AUDIENCE,
    });
    if (!payload.sub || typeof payload.tv !== "number") return null;
    return { memberId: payload.sub, tokenVersion: payload.tv };
  } catch {
    return null;
  }
}
