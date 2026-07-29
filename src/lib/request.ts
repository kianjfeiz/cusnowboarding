import type { NextRequest } from "next/server";

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

/**
 * `claim_attempts.ip` and `email_verifications.ip` are inet columns, so an
 * unparseable value would fail the insert. x-forwarded-for may carry a list;
 * the client is the first entry.
 */
export function clientIp(request: NextRequest | Request): string | null {
  const headers = request.headers;
  const candidate =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip")?.trim() ??
    null;

  if (!candidate) return null;
  if (IPV4.test(candidate) || (candidate.includes(":") && IPV6.test(candidate))) {
    return candidate;
  }
  return null;
}

export function userAgent(request: NextRequest | Request): string | null {
  return request.headers.get("user-agent")?.slice(0, 500) ?? null;
}

/**
 * Validates a `?next=` destination.
 *
 * A prefix check like `startsWith("/") && !startsWith("//")` is NOT enough:
 * WHATWG URL parsing treats a backslash as a slash for special schemes, so
 * `new URL("/\\evil.com", origin)` resolves to `http://evil.com/`.
 *
 * That matters far more than an ordinary open redirect here, because the routes
 * taking a `next` parameter also SET the claim cookie. A member with a valid
 * ready token could otherwise send someone a link on the club's real domain
 * that installs the sender's cookie in the recipient's browser - and then the
 * recipient's click on drop night allocates a spot to the sender.
 *
 * So: resolve it and insist the origin is unchanged.
 */
export function safeNextPath(
  next: string | null | undefined,
  base: string | URL,
  fallback = "/",
): string {
  if (!next) return fallback;
  if (next.includes("\\") || next.includes("\0")) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;

  try {
    const baseUrl = new URL(base);
    const resolved = new URL(next, baseUrl);
    if (resolved.origin !== baseUrl.origin) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
