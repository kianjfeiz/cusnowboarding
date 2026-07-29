"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Notice, formatMoney } from "@/components/ui";

interface ClaimResponse {
  outcome:
    | "held"
    | "waitlisted"
    | "duplicate"
    | "not_open"
    | "unverified"
    | "not_member"
    | "full"
    | "challenge"
    | "error";
  signup: {
    spotNumber: number | null;
    waitlistPosition: number | null;
    status: string;
    paymentDeadlineAt: string | null;
    payToken: string;
    amountCents: number;
  } | null;
}

interface Props {
  tripId: string;
  signupOpensAtMs: number;
  signupClosesAtMs: number | null;
  armed: boolean;
  priceCents: number;
  isOpenStatus: boolean;
  challenge: { phrase: string; token: string } | null;
}

/**
 * Samples the server clock and returns the offset to add to Date.now().
 *
 * The lowest-round-trip sample wins, with half the round trip added back as
 * the estimated one-way delay. A member whose laptop clock is three minutes
 * fast must not see the button arm three minutes early.
 *
 * This only governs what is displayed. The server independently rejects any
 * claim arriving before signup_opens_at, so a tampered clock buys nothing.
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

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function ClaimPanel({
  tripId,
  signupOpensAtMs,
  signupClosesAtMs,
  armed,
  priceCents,
  isOpenStatus,
  challenge,
}: Props) {
  const [offset, setOffset] = useState(0);
  const [remaining, setRemaining] = useState(signupOpensAtMs - Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ClaimResponse | null>(null);
  const [typed, setTyped] = useState("");
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
          body: JSON.stringify({ challengeToken: challenge?.token, typed: value }),
        });
        setResult((await response.json()) as ClaimResponse);
        // Deliberately NOT refreshing the server components here. A refresh
        // re-renders the page with the member's signup resolved, which puts
        // "You are in, spot 1" on screen the instant they stop typing - exactly
        // the scoreboard this flow is meant to avoid. The entry is recorded;
        // the outcome can wait for the email.
      } catch {
        setResult({ outcome: "error", signup: null });
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
    if (challenge && normalize(value) === normalize(challenge.phrase)) {
      void claim(value);
    }
  }

  const block = (event: { preventDefault: () => void }) => event.preventDefault();

  if (result) return <ClaimResult response={result} />;

  if (!armed) {
    return (
      <Notice tone="alert" title="This browser is not armed">
        Arm it before signups open, not at signup time. Until you do, entering is
        not possible on this device.
      </Notice>
    );
  }

  if (!isOpenStatus && remaining <= 0) {
    return <Notice title="Signups are not open">This trip is not accepting signups.</Notice>;
  }

  if (closed) {
    return <Notice title="Signups have closed">This trip is no longer accepting signups.</Notice>;
  }

  return (
    <div className="space-y-4">
      {!open ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center">
          <p className="text-sm text-ink-muted">Signups open in</p>
          <p className="tnum mt-2 text-4xl font-semibold text-ink">
            {formatCountdown(remaining)}
          </p>
          <p className="mt-3 text-xs text-ink-faint">
            You are ready. Keep this page open - a phrase to type appears here
            the moment signups open.
          </p>
        </div>
      ) : null}

      {open && challenge ? (
        <div className="rounded-lg border border-border bg-paper p-5">
          <p className="text-sm text-ink-muted">Type this to enter</p>

          {/*
            Not selectable, and copy is blocked. This is a speed bump against
            casual copy-paste, not a security control - the real protections are
            that the phrase is signed and bound to this member and trip, and
            that one member can only ever hold one spot.
          */}
          <p
            onCopy={block}
            onCut={block}
            onContextMenu={block}
            className="tnum mt-2 select-none rounded-md bg-surface px-4 py-3 text-center text-lg font-medium tracking-wide"
            style={{ WebkitUserSelect: "none", userSelect: "none" }}
          >
            {challenge.phrase}
          </p>

          <input
            ref={inputRef}
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

          <p className="mt-3 text-center text-xs text-ink-faint">
            {formatMoney(priceCents)} · entries are ordered by when they reach our
            server
          </p>
        </div>
      ) : null}

      {open && !challenge ? (
        <Notice tone="alert" title="Reload this page">
          This page has been open too long to enter with. Reload it to get a
          fresh phrase.
        </Notice>
      ) : null}
    </div>
  );
}

function ClaimResult({ response }: { response: ClaimResponse }) {
  const { outcome } = response;

  /**
   * Deliberately says nothing about whether a spot was won.
   *
   * Telling people their position the instant they finish typing turns the
   * drop into a scoreboard: everyone who missed refreshes, re-enters, and
   * messages the board within seconds. Confirming receipt and nothing else
   * ends the race cleanly. The real answer arrives by email and on My trips.
   */
  if (outcome === "held" || outcome === "waitlisted" || outcome === "duplicate") {
    return (
      <Notice tone="accent" title="Entry received">
        <p>
          Your entry was submitted. You will get an email shortly, and you can
          check{" "}
          <a className="font-medium text-accent underline underline-offset-4" href="/me">
            My trips
          </a>{" "}
          any time.
        </p>
      </Notice>
    );
  }

  const messages: Record<string, { title: string; body: string }> = {
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
      title: "You are not verified",
      body: "Verify your email, then reload this page.",
    },
    not_member: {
      title: "Club dues required",
      body: "This trip is limited to members with dues paid. Contact the treasurer.",
    },
    error: {
      title: "Something went wrong",
      body: "Your spot was not claimed. Reload the page and try again.",
    },
  };

  const message = messages[outcome] ?? messages.error;
  return (
    <Notice tone="alert" title={message.title}>
      {message.body}
    </Notice>
  );
}
