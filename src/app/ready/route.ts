import { NextResponse, type NextRequest } from "next/server";
import {
  MEMBER_COOKIE,
  issueMemberToken,
  memberCookieOptions,
  verifyReadyToken,
} from "@/lib/member-session";
import { safeNextPath } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-arms the verification cookie on a new device.
 *
 * Members verify whenever they get around to it, then race on whatever device
 * is nearest at 8pm. Without this, verifying on a laptop and opening the trip
 * page on a phone would leave them unarmed at the moment it matters. The
 * pre-drop reminder emails link here.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");
  const next = request.nextUrl.searchParams.get("next");

  // This route hands out the claim cookie, so an unvalidated destination would
  // be a cookie-fixation vector, not merely an open redirect. See safeNextPath.
  const destination = safeNextPath(next, request.url);

  const session = token ? await verifyReadyToken(token) : null;
  if (!session) {
    return NextResponse.redirect(new URL("/?ready=expired", request.url));
  }

  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.set(
    MEMBER_COOKIE,
    await issueMemberToken(session),
    memberCookieOptions(),
  );
  return response;
}
