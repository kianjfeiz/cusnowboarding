"use client";

import { useEffect, useState } from "react";

function format(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * A live countdown to a timestamp, for the home page's next-drop hero.
 *
 * Display only. The claim path has its own clock-offset measurement and the
 * server re-checks every claim's arrival time, so this one runs off the local
 * clock without apology - being a second or two out changes nothing but the
 * digits. It keeps ticking under reduced motion because it is a clock, not an
 * effect; `tnum` is what stops the digits jittering sideways.
 *
 * `suppressHydrationWarning` because the server rendered a different second
 * than the client's first paint, by definition.
 */
export function CountdownChip({ targetMs, doneLabel }: { targetMs: number; doneLabel: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = targetMs - now;

  return (
    <span suppressHydrationWarning className="tnum">
      {remaining <= 0 ? doneLabel : format(remaining)}
    </span>
  );
}
