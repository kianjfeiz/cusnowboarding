"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "./format";

/**
 * Ticks against the client clock, which is fine here: this is the board's own
 * "how long until the drop" readout, not the fairness mechanism. The claim
 * itself is ordered inside Postgres and ignores every clock but its own.
 */
export function Countdown({
  targetMs,
  passedLabel = "now",
}: {
  targetMs: number;
  passedLabel?: string;
}) {
  const [remaining, setRemaining] = useState(() => targetMs - Date.now());

  useEffect(() => {
    const id = setInterval(() => setRemaining(targetMs - Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  if (remaining <= 0) return <span className="tnum">{passedLabel}</span>;
  return <span className="tnum">{formatDuration(remaining)}</span>;
}
