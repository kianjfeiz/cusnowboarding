import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  /**
   * The site is sign-in only, so this matches nearly everything. The exclusions
   * are load-bearing:
   *
   *   api/trips/.../claim - THE DROP PATH. It authenticates itself from the
   *     csc_member cookie in process; middleware latency here is measured in
   *     lost spots. Never match it.
   *   api/auth, login     - sign-in cannot require being signed in.
   *   api/cron            - authenticated by CRON_SECRET.
   *   api/member/arm      - mints the claim cookie right after sign-in.
   *   api/time, api/warm  - no data, and warm must stay cheap.
   */
  matcher: [
    "/((?!login|api/auth|api/cron|api/member/arm|api/time|api/warm|api/trips/[^/]+/claim|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|txt|xml)$).*)",
  ],
};
