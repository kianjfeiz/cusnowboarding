import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/**
 * The member's claim credential, and what keeps drop-time latency at exactly
 * one database round trip. Google sign-in happens days earlier and is collapsed
 * into a signed cookie by `/api/member/arm`; at the drop the claim handler does
 * an in-process HMAC verification and passes the member id straight into the
 * claim statement, which re-validates the member row it is already touching.
 */

export const MEMBER_COOKIE = "csc_member";
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export interface MemberSession {
  memberId: string;
  tokenVersion: number;
}

/** Also signs the typing challenge, which is why token audiences must stay disjoint. */
export function memberJwtSecret(): Uint8Array {
  const value = process.env.MEMBER_JWT_SECRET;
  if (!value) throw new Error("MEMBER_JWT_SECRET is not set");
  return new TextEncoder().encode(value);
}

const MEMBER_AUDIENCE = "member";

export async function issueMemberToken(session: MemberSession): Promise<string> {
  return new SignJWT({ tv: session.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.memberId)
    .setAudience(MEMBER_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(memberJwtSecret());
}

export async function verifyMemberToken(token: string): Promise<MemberSession | null> {
  try {
    const { payload } = await jwtVerify(token, memberJwtSecret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.tv !== "number") return null;
    // Any other audience-scoped token signed with this secret must never verify
    // as the member credential. Checked by hand rather than via jwtVerify's
    // `audience` option because cookies minted before audiences existed carry
    // none: a missing audience is legacy, a foreign one is a different token.
    if (payload.aud !== undefined && payload.aud !== MEMBER_AUDIENCE) return null;
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

