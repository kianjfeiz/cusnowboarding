"use client";

import { useEffect, useState } from "react";
import { formatCountdown } from "@/components/ui";

/**
 * A live countdown for the home page's next-drop hero. Display only, so it runs
 * off the local clock; the claim panel measures the server offset itself.
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
      {remaining <= 0 ? doneLabel : formatCountdown(remaining)}
    </span>
  );
}
