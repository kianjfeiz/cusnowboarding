"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Notice, formatCountdown } from "@/components/ui";

/**
 * The server answers "received" for any entry that landed - won, waitlisted or
 * already in - and says which only in the roster release email. See the claim route.
 */
type Outcome =
  | "received"
  | "not_open"
  | "unverified"
  | "not_member"
  | "full"
  | "challenge"
  | "error";

interface Props {
  tripId: string;
  signupOpensAtMs: number;
  signupClosesAtMs: number | null;
  isOpenStatus: boolean;
  challenge: { phrase: string; token: string };
  /** Who the entry will be made as, for a shared or borrowed device. */
  enteringAs: string;
}

/**
 * Samples the server clock and returns the offset to add to Date.now(), so a
 * laptop clock three minutes fast does not open the form three minutes early.
 * The lowest-round-trip sample wins. Display only: the claim statement checks
 * signup_opens_at itself, so a tampered clock buys nothing.
 */
async function measureClockOffset(samples = 3): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  let offset = 0;

  for (let i = 0; i < samples; i++) {
    const sentAt = Date.now();
    try {
      const response = await fetch("/api/time", { cache: "no-store" });
      const { now } = (await response.json()) as { now: number };
      const receivedAt = Date.now();
      const roundTrip = receivedAt - sentAt;
      if (roundTrip < best) {
        best = roundTrip;
        offset = now + roundTrip / 2 - receivedAt;
      }
    } catch {
      // Keep whatever we have; a failed sample just means less precision.
    }
  }

  return Number.isFinite(best) ? offset : 0;
}

export function ClaimPanel({
  tripId,
  signupOpensAtMs,
  signupClosesAtMs,
  isOpenStatus,
  challenge,
  enteringAs,
}: Props) {
  const [offset, setOffset] = useState(0);
  const [remaining, setRemaining] = useState(signupOpensAtMs - Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [typed, setTyped] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    measureClockOffset().then((value) => {
      if (!cancelled) setOffset(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const tick = () => setRemaining(signupOpensAtMs - (Date.now() + offset));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [signupOpensAtMs, offset]);

  const closed =
    signupClosesAtMs !== null && Date.now() + offset > signupClosesAtMs;
  const open = isOpenStatus && remaining <= 0 && !closed;

  const claim = useCallback(
    async (value: string) => {
      // Guard against a double submit burning a second sequence number.
      if (inFlight.current) return;
      inFlight.current = true;
      setSubmitting(true);

      try {
        const response = await fetch(`/api/trips/${tripId}/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ challengeToken: challenge.token, typed: value }),
        });
        setOutcome(((await response.json()) as { outcome: Outcome }).outcome);
        // Deliberately NOT refreshing the server components: the page must not
        // re-render around the new signup the instant they stop typing.
      } catch {
        setOutcome("error");
      } finally {
        setSubmitting(false);
        // Deliberately not resetting inFlight: one entry per page load.
      }
    },
    [tripId, challenge],
  );

  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

  function onType(value: string) {
    if (inFlight.current) return;
    setTyped(value);

    // Auto-submits the instant the phrase matches. No button to hunt for, and
    // no extra click between finishing typing and the request going out.
    if (normalize(value) === normalize(challenge.phrase)) {
      void claim(value);
    }
  }

  const block = (event: { preventDefault: () => void }) => event.preventDefault();

  if (outcome) return <ClaimResult outcome={outcome} />;

  if ((!isOpenStatus && remaining <= 0) || closed) {
    return <Notice title="Signups are closed" />;
  }

  if (!open) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center">
        <p className="text-sm text-ink-muted">Signups open in</p>
        <p className="tnum mt-2 text-4xl font-semibold text-ink">{formatCountdown(remaining)}</p>
        <p className="mt-3 text-xs text-ink-muted">
          Keep this page open. The phrase to type appears here when signups open.
        </p>
        <p className="mt-1 text-xs text-ink-faint">Entering as {enteringAs}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-paper p-5">
      <p className="text-sm text-ink-muted">Type this phrase to enter</p>

      {/* Blocking copy is a speed bump, not a security control: the phrase is
          signed and bound to this member and trip. */}
      <p
        onCopy={block}
        onCut={block}
        onContextMenu={block}
        className="tnum mt-2 select-none rounded-md bg-surface px-4 py-3 text-center text-lg font-medium tracking-wide"
      >
        {challenge.phrase}
      </p>

      <input
        value={typed}
        onChange={(e) => onType(e.target.value)}
        onPaste={block}
        onDrop={block}
        disabled={submitting}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Type the phrase shown above"
        placeholder="Start typing"
        className="mt-3 h-12 w-full rounded-md border border-border bg-paper px-3 text-center text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />

      <p className="mt-3 text-center text-xs text-ink-faint">Entering as {enteringAs}</p>
    </div>
  );
}

const FAILURES: Record<Exclude<Outcome, "received">, { title: string; body: string }> = {
  challenge: {
    title: "That did not go through",
    body: "Reload the page and enter again.",
  },
  full: {
    title: "This trip is full",
    body: "Both the trip and its waitlist are at capacity.",
  },
  not_open: {
    title: "Signups are not open",
    body: "This trip is not currently accepting signups.",
  },
  unverified: {
    title: "This browser is not set up",
    body: "Sign out and back in, then reload this page.",
  },
  not_member: {
    title: "Club dues required",
    body: "This trip is limited to members with dues paid. Contact the treasurer.",
  },
  error: {
    title: "Something went wrong",
    body: "Your entry did not go through. Reload the page and try again.",
  },
};

function ClaimResult({ outcome }: { outcome: Outcome }) {
  // Says nothing about whether a spot was won: confirming receipt and nothing
  // else is what stops the drop becoming a scoreboard of refreshes.
  if (outcome === "received") {
    return (
      <Notice tone="accent" title="Entry received">
        If you get a spot, you get an email when the board releases the roster, and the
        trip moves to{" "}
        <a className="font-medium text-accent underline underline-offset-4" href="/me">
          My trips
        </a>
        . Either way, this page shows where you stand.
      </Notice>
    );
  }

  const failure = FAILURES[outcome] ?? FAILURES.error;
  return (
    <Notice tone="alert" title={failure.title}>
      {failure.body}
    </Notice>
  );
}
