import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { lookupMemberByEmail } from "@/lib/member-account";
import {
  MEMBER_COOKIE,
  issueMemberToken,
  memberCookieOptions,
} from "@/lib/member-session";
import { safeNextPath } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Converts a Google session into the `csc_member` claim cookie.
 *
 * The drop-time claim reads exactly one credential - that cookie - and verifies
 * it in-process with no database or network call. Teaching it to also
 * understand an Auth.js session would put a second code path on the one route
 * where latency and correctness matter most, for no gain.
 *
 * So sign-in redirects through here instead. Signing in with Google arms the
 * member for the next drop, and the claim route stays exactly as it was tested.
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

  /*
    First sign-in detour: someone who has never typed their own name gets the
    welcome page before their destination. The claim cookie is still minted on
    THIS response - arm stays the only place that mints it - so the welcome
    page can identify the member from the cookie like any other page, and a
    member who abandons the form is still armed for the next drop.
  */
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
