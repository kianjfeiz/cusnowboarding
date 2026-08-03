"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Badge, Button, Input } from "@/components/ui";

/**
 * Search the club, put someone on the trip.
 *
 * The roster below is the list of people who won a spot; this is the one way to
 * add somebody who did not. It is a search box rather than a dropdown because
 * the club is several hundred people and the board is looking for exactly one
 * of them, whose name they already know.
 *
 * Every result stays visible, including people who are already on the trip -
 * seeing "already on the trip" next to a name is the answer to the question the
 * board was asking, and hiding the row would read as "no such member".
 */

export interface AddableResult {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  is_club_member: boolean;
  is_blocked: boolean;
  signup_status: string | null;
}

export interface AddResult {
  ok: boolean;
  message: string;
}

/** Typing pauses this long before a query goes out. */
const DEBOUNCE_MS = 250;

const STANDING: Record<string, string> = {
  held: "Already on the trip",
  paid: "Already paid",
  waitlisted: "Already waitlisted",
};

export function RosterAdd({
  tripId,
  freeSpots,
  notifies,
  search,
  add,
}: {
  tripId: string;
  /** Drives whether "Add to trip" is offered; the transaction re-checks it. */
  freeSpots: number;
  /** True once results are out, when adding someone emails them. */
  notifies: boolean;
  search: (tripId: string, query: string) => Promise<AddableResult[]>;
  add: (tripId: string, memberId: string, to: "trip" | "waitlist") => Promise<AddResult>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddableResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<AddResult | null>(null);
  const [pending, startTransition] = useTransition();

  /*
    Every search carries the query it was fired for, and a reply is dropped
    unless it is still the current one. Without that, a slow request for "ki"
    can land after a fast one for "kian" and repopulate the list with the
    results of a search the board has already moved past.
  */
  const latest = useRef("");

  useEffect(() => {
    const term = query.trim();
    latest.current = term;

    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = setTimeout(() => {
      search(tripId, term)
        .then((rows) => {
          if (latest.current !== term) return;
          setResults(rows);
          setSearching(false);
        })
        .catch(() => {
          if (latest.current !== term) return;
          setResults([]);
          setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, tripId, search]);

  function onAdd(memberId: string, to: "trip" | "waitlist") {
    setResult(null);
    startTransition(async () => {
      const outcome = await add(tripId, memberId, to);
      setResult(outcome);
      if (outcome.ok) {
        // The roster above has just changed underneath the box. Clearing it
        // makes that the thing the board looks at next, rather than a stale
        // list of buttons half of which no longer do anything.
        setQuery("");
        setResults([]);
      }
    });
  }

  return (
    <div className="px-5 py-4">
      <label className="block">
        <span className="sr-only">Search members by name or email</span>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or email"
          autoComplete="off"
        />
      </label>

      <p className="mt-2 text-xs text-ink-muted">
        {notifies
          ? "Results are out, so anyone added here is emailed straight away with their spot and payment deadline."
          : "Nobody has been told anything yet, so adding someone here sends no email."}
      </p>

      {result ? (
        <p
          role="status"
          className={`mt-3 text-sm ${result.ok ? "text-ink" : "text-alert"}`}
        >
          {result.message}
        </p>
      ) : null}

      {query.trim().length >= 2 ? (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {results.length === 0 ? (
            <li className="py-3 text-sm text-ink-muted">
              {searching ? "Searching" : "Nobody matches that."}
            </li>
          ) : (
            results.map((person) => {
              const standing = person.signup_status
                ? STANDING[person.signup_status]
                : null;

              return (
                <li
                  key={person.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">
                      {person.first_name} {person.last_name}
                      {person.is_club_member ? null : (
                        <span className="ml-2 text-xs text-ink-faint">No dues</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-ink-muted">{person.email}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {person.is_blocked ? (
                      <Badge emphasis="muted">Blocked</Badge>
                    ) : standing ? (
                      <Badge emphasis="muted">{standing}</Badge>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-8 px-3 text-xs"
                          disabled={pending || freeSpots === 0}
                          title={freeSpots === 0 ? "No spot is free" : undefined}
                          onClick={() => onAdd(person.id, "trip")}
                        >
                          Add to trip
                        </Button>
                        <Button
                          type="button"
                          variant="quiet"
                          className="h-8 px-3 text-xs"
                          disabled={pending}
                          onClick={() => onAdd(person.id, "waitlist")}
                        >
                          Waitlist
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
