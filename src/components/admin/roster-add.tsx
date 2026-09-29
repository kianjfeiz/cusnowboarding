"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Badge, Button, Input } from "@/components/ui";
import type { AddableMember } from "@/app/admin/_lib/queries";
import type { RosterSaveResult } from "./roster-board";

/**
 * Search the club, put someone on the trip: the one way onto a roster for
 * somebody who did not win a spot.
 *
 * Every result stays visible, including people already on the trip - hiding the
 * row would read as "no such member".
 */

/** Typing pauses this long before a query goes out. */
const DEBOUNCE_MS = 250;

const STANDING: Record<string, string> = {
  held: "On the trip",
  paid: "On the trip",
  waitlisted: "On the waitlist",
};

export function RosterAdd({
  tripId,
  canWaitlist,
  search,
  add,
}: {
  tripId: string;
  /**
   * Whether "Add to waitlist" is offered: not while the drop can still hand out
   * spots (the transaction refuses it then too). "Add to trip" always is -
   * capacity is a target, so a full trip takes them past it.
   */
  canWaitlist: boolean;
  search: (tripId: string, query: string) => Promise<AddableMember[]>;
  add: (
    tripId: string,
    memberId: string,
    to: "trip" | "waitlist",
  ) => Promise<RosterSaveResult>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddableMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<RosterSaveResult | null>(null);
  const [pending, startTransition] = useTransition();

  // A reply is dropped unless it is still for the current query, or a slow
  // request for "ki" lands after a fast one for "kian" and overwrites it.
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
        .catch(() => [])
        .then((rows) => {
          if (latest.current !== term) return;
          setResults(rows);
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
      // The roster has just changed; a stale list of Add buttons would not.
      if (outcome.ok) {
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
                          disabled={pending}
                          onClick={() => onAdd(person.id, "trip")}
                        >
                          Add to trip
                        </Button>
                        {canWaitlist ? (
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-8 px-3 text-xs"
                            disabled={pending}
                            onClick={() => onAdd(person.id, "waitlist")}
                          >
                            Add to waitlist
                          </Button>
                        ) : null}
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
