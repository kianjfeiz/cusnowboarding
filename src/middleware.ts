import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  /**
   * The site is sign-in only, so this matches nearly everything. The exclusions
   * are load-bearing, not tidiness:
   *
   *   api/trips/.../claim - THE DROP PATH. Middleware runs before every matched
   *     request, and this is the one route where added latency is measured in
   *     lost spots. It authenticates itself from the csc_member cookie in
   *     process. Never match it here.
   *   api/auth       - sign-in itself cannot require being signed in.
   *   api/cron       - authenticated by CRON_SECRET, called by a scheduler.
   *   api/member/arm - the bridge that mints the claim cookie right after
   *     sign-in completes.
   *   ready          - re-arms a member from an emailed link.
   *   api/time, api/warm - no data, and warm must stay cheap.
   *   login          - obviously.
   *
   * Everything else, including the trip pages, now requires a session.
   */
  matcher: [
    "/((?!login|ready|api/auth|api/cron|api/member/arm|api/time|api/warm|api/trips/[^/]+/claim|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|txt|xml)$).*)",
  ],
};
