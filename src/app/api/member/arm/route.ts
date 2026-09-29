import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { lookupMemberByEmail } from "@/lib/auth/member-account";
import {
  MEMBER_COOKIE,
  issueMemberToken,
  memberCookieOptions,
} from "@/lib/auth/member-session";
import { safeNextPath } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Converts a Google session into the `csc_member` claim cookie, the only
 * credential the claim route reads. Sign-in redirects through here so the claim
 * path never has to learn about Auth.js sessions.
 */
export async function GET(request: NextRequest) {
  const destination = safeNextPath(request.nextUrl.searchParams.get("next"), request.url);

  const session = await auth();
  const email = session?.user?.email;

  if (!email) {
    return NextResponse.redirect(new URL("/login?error=session", request.url));
  }

  // Re-read rather than trusting the token: a member blocked since sign-in must
  // not walk away with a fresh claim cookie.
  const member = await lookupMemberByEmail(email);
  if (!member) {
    return NextResponse.redirect(new URL("/login?error=no_member", request.url));
  }

  // First sign-in detours through /welcome. The cookie is still minted on THIS
  // response, so a member who abandons the name form is armed regardless.
  const destinationUrl =
    member.nameConfirmedAt === null
      ? new URL(`/welcome?next=${encodeURIComponent(destination)}`, request.url)
      : new URL(destination, request.url);

  const response = NextResponse.redirect(destinationUrl);
  response.cookies.set(
    MEMBER_COOKIE,
    await issueMemberToken({ memberId: member.id, tokenVersion: member.tokenVersion }),
    memberCookieOptions(),
  );
  return response;
}
