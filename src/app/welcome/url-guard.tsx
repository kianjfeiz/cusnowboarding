"use client";

import { useEffect } from "react";

/**
 * Re-anchors the browser onto /welcome when this page was reached through a
 * server-action redirect chain.
 *
 * The dev sign-in form is a server action, and the client router follows its
 * redirects (login action -> /api/member/arm -> /welcome) inside fetch, leaving
 * the address bar parked on the arm route while rendering this page under it.
 * The name form would then POST its action to that URL - a route handler that
 * only answers GET. A real browser navigation (the production Google OAuth
 * callback) never hits this; the replace below is a no-op there.
 */
export function WelcomeUrlGuard() {
  useEffect(() => {
    if (window.location.pathname === "/welcome") return;
    const next = new URLSearchParams(window.location.search).get("next") ?? "/me";
    window.location.replace(`/welcome?next=${encodeURIComponent(next)}`);
  }, []);

  return null;
}
