"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { CARD_BUTTON } from "@/components/admin/shell";
import { Badge, Button, cn } from "@/components/ui";

/**
 * The trip's roster as two lists the board drags people between, from the drop
 * through to the trip itself. Both lists always read in arrival order, so the
 * waitlist shows who is next; the board decides who is on which list, not the
 * order. Nothing is saved until Save is pressed: a half-applied change is
 * exactly the state the server transaction refuses to accept anyway. Capacity
 * is a target, so the trip list may run over it.
 *
 * Every card carries a move button as well as being draggable, because a drag
 * is unreachable by keyboard and this is often done one-handed on a phone.
 *
 * Board members who may not curate get the same two lists without the moves,
 * so everyone reads the roster in one shape.
 */

export interface RosterCardData {
  id: string;
  name: string;
  email: string;
  /** Server arrival order. Never rewritten; the lists are sorted on it. */
  claimSeq: number;
  isPaid: boolean;
  hasDues: boolean;
  phone?: string | null;
  /** Moved up off the waitlist by the board after the roster was released. */
  promoted?: boolean;
  /** Payment state once the roster is out, as a word: "Paid", "Unpaid". */
  status?: string | null;
  /** The detail after it, e.g. "Due Oct 3, 5:00 PM MDT". */
  note?: string | null;
  /** Server-rendered remove button, sized with CARD_BUTTON. */
  actions?: ReactNode;
}

export interface RosterSaveResult {
  ok: boolean;
  message: string;
}

type ListKey = "onTrip" | "waitlisted";
type Lists = Record<ListKey, string[]>;

export function RosterBoard({
  tripId,
  capacity,
  onTrip,
  waitlisted,
  save,
  editable,
  sendAction,
}: {
  tripId: string;
  capacity: number;
  onTrip: RosterCardData[];
  waitlisted: RosterCardData[];
  save: (
    tripId: string,
    onTrip: string[],
    waitlisted: string[],
  ) => Promise<RosterSaveResult>;
  /** False shows the lists without drag, move buttons or the save bar. */
  editable: boolean;
  /**
   * The "Release roster and notify" form, or null once there is nothing to
   * release. Shown only while the list on screen matches the list on the
   * server: publishing an arrangement the board can see but has not saved is
   * the one mistake here that cannot be taken back.
   */
  sendAction: ReactNode | null;
}) {
  // Membership lives in state as ids; the cards themselves are always read from
  // props, so a payment recorded elsewhere shows up on the next refresh.
  const byId = useMemo(
    () => new Map([...onTrip, ...waitlisted].map((card) => [card.id, card])),
    [onTrip, waitlisted],
  );
  const inArrivalOrder = (cards: RosterCardData[]) =>
    [...cards].sort((a, b) => a.claimSeq - b.claimSeq).map((card) => card.id);
  const [baseline, setBaseline] = useState<Lists>({
    onTrip: inArrivalOrder(onTrip),
    waitlisted: inArrivalOrder(waitlisted),
  });
  const [lists, setLists] = useState<Lists>(baseline);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overList, setOverList] = useState<ListKey | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [result, setResult] = useState<RosterSaveResult | null>(null);
  const [pending, startTransition] = useTransition();

  const baselineOnTrip = new Set(baseline.onTrip);
  const dirty =
    lists.onTrip.length !== baseline.onTrip.length ||
    lists.onTrip.some((id) => !baselineOnTrip.has(id));
  const over = lists.onTrip.length - capacity;

  function moveTo(id: string, toList: ListKey) {
    const card = byId.get(id);
    const fromList: ListKey = lists.onTrip.includes(id) ? "onTrip" : "waitlisted";
    if (!card || fromList === toList) return;

    if (card.isPaid && toList === "waitlisted") {
      setAnnouncement(`${card.name} has paid and cannot be moved to the waitlist.`);
      return;
    }

    const arrival = (other: string) => byId.get(other)?.claimSeq ?? 0;
    setLists({
      [fromList]: lists[fromList].filter((other) => other !== id),
      [toList]: [...lists[toList], id].sort((a, b) => arrival(a) - arrival(b)),
    } as Lists);
    setAnnouncement(`${card.name} moved to ${toList === "onTrip" ? "the trip" : "the waitlist"}.`);
    setResult(null);
  }

  function onSave() {
    const snapshot = lists;
    startTransition(async () => {
      const saved = await save(tripId, snapshot.onTrip, snapshot.waitlisted);
      setResult(saved);
      if (saved.ok) setBaseline(snapshot);
    });
  }

  function onReset() {
    setLists(baseline);
    setResult(null);
    setAnnouncement("Changes discarded.");
  }

  function column(list: ListKey, heading: string, count: string, empty: string) {
    const cards = lists[list].flatMap((id) => byId.get(id) ?? []);
    const other: ListKey = list === "onTrip" ? "waitlisted" : "onTrip";

    return (
      <section
        onDragOver={
          editable
            ? (event) => {
                event.preventDefault();
                setOverList(list);
              }
            : undefined
        }
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverList(null);
        }}
        onDrop={
          editable
            ? (event) => {
                event.preventDefault();
                const id = dragId ?? event.dataTransfer.getData("text/plain");
                setDragId(null);
                setOverList(null);
                if (id) moveTo(id, list);
              }
            : undefined
        }
        className={cn(
          "min-w-0 rounded-lg border bg-paper transition-colors",
          dragId && overList === list ? "border-accent" : "border-border",
        )}
      >
        <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{heading}</h2>
          <span className="tnum text-xs text-ink-muted">{count}</span>
        </header>

        <ul className="space-y-2 p-2">
          {cards.length === 0 ? (
            <li className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-ink-faint">
              {empty}
            </li>
          ) : null}

          {cards.map((card, index) => {
            // A paid rider cannot go to the waitlist, so there is nowhere to drag them.
            const movable = editable && !(card.isPaid && list === "onTrip");
            const hasStatus = card.status || card.note || card.promoted || !card.hasDues;
            return (
              <li
                key={card.id}
                draggable={movable}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", card.id);
                  setDragId(card.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverList(null);
                }}
                className={cn(
                  "rounded-md border px-3 py-2 transition-colors",
                  dragId === card.id ? "border-accent bg-accent-soft" : "border-border bg-paper",
                  movable ? "cursor-grab" : "cursor-default",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1 basis-44">
                    <p className="truncate text-sm font-medium">
                      <span className="tnum text-ink-faint">{index + 1}.</span> {card.name}
                    </p>
                    <p className="truncate text-xs text-ink-muted">
                      {card.email}
                      {card.phone ? ` · ${card.phone}` : ""}
                    </p>
                    {hasStatus ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                        {card.status ? (
                          <Badge emphasis={card.isPaid ? "strong" : "normal"}>{card.status}</Badge>
                        ) : null}
                        {card.hasDues ? null : <Badge>No dues</Badge>}
                        {card.promoted ? <Badge emphasis="muted">Moved up</Badge> : null}
                        {card.note ? <span>{card.note}</span> : null}
                      </div>
                    ) : null}
                  </div>

                  {movable || card.actions ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {movable ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => moveTo(card.id, other)}
                          className={CARD_BUTTON}
                        >
                          {list === "onTrip" ? "Move to waitlist" : "Move to trip"}
                        </Button>
                      ) : null}
                      {/* A remove reloads the board from the server, which would
                          drop unsaved moves, so it waits until they are saved. */}
                      <fieldset disabled={dirty} className="contents">
                        {card.actions}
                      </fieldset>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  // Once the roster is out and nothing is pending there is nothing to say, so
  // the bar only appears for a change, a save result, or the release itself.
  const showBar = editable && (dirty || result !== null || sendAction !== null);
  const releasePrompt = !dirty && sendAction !== null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {column(
          "onTrip",
          "On the trip",
          `${lists.onTrip.length}/${capacity}${
            over < 0 ? ` · ${-over} free` : over > 0 ? ` · ${over} over` : " · full"
          }`,
          "Nobody on the trip yet.",
        )}
        {column("waitlisted", "Waitlist", `${lists.waitlisted.length} waiting`, "Nobody waitlisted.")}
      </div>

      {showBar ? (
        // Pinned so Save and Release stay reachable from anywhere in a
        // thirty-card list.
        <div
          className={cn(
            "sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3",
            releasePrompt ? "border-accent/30 bg-accent-soft" : "border-border bg-surface",
          )}
        >
          <p className="min-w-0 flex-1 basis-64 text-sm">
            {dirty ? (
              result && !result.ok ? (
                <span className="text-alert">{result.message}</span>
              ) : (
                <>
                  <span className="font-medium">Unsaved changes.</span>
                  {sendAction ? (
                    <span className="text-ink-muted"> Save them before releasing the roster.</span>
                  ) : null}
                </>
              )
            ) : releasePrompt ? (
              <>
                {result?.ok ? <span className="font-medium">Saved. </span> : null}
                <span className="text-ink-muted">
                  {lists.onTrip.length === 0
                    ? "Nobody is on the trip, so releasing only closes signups."
                    : `Releasing closes signups and emails the ${lists.onTrip.length} on the trip. The waitlist and board seats are not emailed.`}{" "}
                  It cannot be undone.
                </span>
              </>
            ) : (
              <span className="font-medium">Saved.</span>
            )}
          </p>
          <div className="flex gap-2">
            {dirty ? (
              <>
                <Button variant="secondary" onClick={onReset} disabled={pending}>
                  Reset
                </Button>
                <Button onClick={onSave} disabled={pending}>
                  {pending ? "Saving" : "Save"}
                </Button>
              </>
            ) : (
              sendAction
            )}
          </div>
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
