"use client";

import { useMemo, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { Badge, Button, Notice, cn } from "@/components/ui";

/**
 * The board the travel coordinator curates on between the drop and "Send
 * results". Nothing here is saved until Save is pressed: dragging thirty people
 * around while each move round-trips would make a slow network feel like the
 * list is fighting back, and a half-applied ordering is exactly the state the
 * server transaction refuses to accept anyway.
 *
 * Drag-and-drop is the fast path, not the only path. Every card carries move and
 * reorder buttons because this is often done one-handed on a phone, and because
 * a drag gesture is unreachable by keyboard.
 */

export interface RosterCardData {
  id: string;
  name: string;
  email: string;
  /** Server arrival order. Never rewritten - it is why the list starts as it does. */
  claimSeq: number;
  isPaid: boolean;
  hasDues: boolean;
}

export interface RosterSaveResult {
  ok: boolean;
  message: string;
}

type ListKey = "onTrip" | "waitlisted";
type Lists = Record<ListKey, string[]>;

const LIST_LABEL: Record<ListKey, string> = {
  onTrip: "the trip",
  waitlisted: "the waitlist",
};

const PAID_EXPLANATION =
  "Paid - stays on the trip. Removing them is a refund, so use Cancel on the roster.";

export function RosterBoard({
  tripId,
  capacity,
  cards,
  initialOnTrip,
  initialWaitlisted,
  save,
  sendAction,
}: {
  tripId: string;
  capacity: number;
  cards: RosterCardData[];
  initialOnTrip: string[];
  initialWaitlisted: string[];
  save: (
    tripId: string,
    onTrip: string[],
    waitlisted: string[],
  ) => Promise<RosterSaveResult>;
  /**
   * The "Send results" form, rendered here rather than at the top of the page so
   * that curating and publishing are one motion. It appears only once the list
   * on screen matches the list on the server: publishing an arrangement the
   * board can see but has not saved is the one mistake on this screen that
   * cannot be taken back.
   */
  sendAction?: ReactNode;
}) {
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);

  const [baseline, setBaseline] = useState<Lists>({
    onTrip: initialOnTrip,
    waitlisted: initialWaitlisted,
  });
  const [lists, setLists] = useState<Lists>(baseline);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ list: ListKey; index: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [result, setResult] = useState<RosterSaveResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    !sameOrder(lists.onTrip, baseline.onTrip) ||
    !sameOrder(lists.waitlisted, baseline.waitlisted);
  const over = lists.onTrip.length - capacity;

  function announce(message: string) {
    setAnnouncement(message);
    setResult(null);
  }

  function moveTo(id: string, toList: ListKey, toIndex: number) {
    const card = byId.get(id);
    if (!card) return;

    if (card.isPaid && toList === "waitlisted") {
      announce(`${card.name} has paid and cannot be moved off the trip.`);
      return;
    }

    const fromList: ListKey = lists.onTrip.includes(id) ? "onTrip" : "waitlisted";
    const next: Lists = { onTrip: [...lists.onTrip], waitlisted: [...lists.waitlisted] };
    const from = next[fromList].indexOf(id);
    if (from === -1) return;

    next[fromList].splice(from, 1);

    // toIndex was measured against the list before the card was lifted out of it.
    let index = fromList === toList && from < toIndex ? toIndex - 1 : toIndex;
    index = Math.max(0, Math.min(index, next[toList].length));
    next[toList].splice(index, 0, id);

    setLists(next);
    announce(`${card.name} moved to ${LIST_LABEL[toList]}, position ${index + 1}.`);
  }

  function nudge(id: string, list: ListKey, delta: -1 | 1) {
    const order = [...lists[list]];
    const from = order.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= order.length) return;

    [order[from], order[to]] = [order[to], order[from]];
    setLists({ ...lists, [list]: order });
    announce(`${byId.get(id)?.name ?? "Signup"} moved to position ${to + 1}.`);
  }

  function hoverAt(list: ListKey, index: number) {
    setDrop((prev) =>
      prev && prev.list === list && prev.index === index ? prev : { list, index },
    );
  }

  function handleDrop(event: DragEvent, list: ListKey, index: number) {
    event.preventDefault();
    event.stopPropagation();
    const id = dragId ?? event.dataTransfer.getData("text/plain");
    setDragId(null);
    setDrop(null);
    if (id) moveTo(id, list, index);
  }

  function onSave() {
    const snapshot = lists;
    startTransition(async () => {
      const saved = await save(tripId, snapshot.onTrip, snapshot.waitlisted);
      setResult(saved);
      if (saved.ok) setBaseline(snapshot);
    });
  }

  function column(list: ListKey, heading: string, count: string) {
    const ids = lists[list];

    return (
      <section className="rounded-lg border border-border bg-paper">
        <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{heading}</h2>
          <span className="tnum text-xs text-ink-faint">{count}</span>
        </header>

        <ul
          className="space-y-1 p-2"
          onDragOver={(event) => {
            event.preventDefault();
            hoverAt(list, ids.length);
          }}
          onDrop={(event) => handleDrop(event, list, ids.length)}
        >
          {ids.length === 0 ? (
            <li className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-ink-faint">
              Empty. Drag someone across, or use the move buttons.
            </li>
          ) : null}

          {ids.map((id, index) => {
            const card = byId.get(id);
            if (!card) return null;

            return (
              <li key={id}>
                <Indicator active={drop?.list === list && drop.index === index} />
                <div
                  draggable={!card.isPaid}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", id);
                    setDragId(id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDrop(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const box = event.currentTarget.getBoundingClientRect();
                    const before = event.clientY < box.top + box.height / 2;
                    hoverAt(list, before ? index : index + 1);
                  }}
                  onDrop={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    const before = event.clientY < box.top + box.height / 2;
                    handleDrop(event, list, before ? index : index + 1);
                  }}
                  className={cn(
                    "rounded-md border px-3 py-2.5 transition-colors",
                    dragId === id
                      ? "border-accent bg-accent-soft"
                      : "border-border bg-paper",
                    card.isPaid ? "cursor-default" : "cursor-grab",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        <span className="tnum text-ink-faint">{index + 1}.</span>{" "}
                        {card.name}
                      </p>
                      <p className="truncate text-xs text-ink-muted">{card.email}</p>
                    </div>
                    <span
                      className="tnum shrink-0 text-xs text-ink-faint"
                      title="Arrival order on drop night"
                    >
                      #{card.claimSeq}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {card.isPaid ? <Badge emphasis="strong">Paid</Badge> : null}
                    <Badge emphasis={card.hasDues ? "muted" : "normal"}>
                      {card.hasDues ? "Dues paid" : "No dues"}
                    </Badge>
                  </div>

                  {card.isPaid ? (
                    <p className="mt-1.5 text-xs text-ink-faint">{PAID_EXPLANATION}</p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-1">
                    <Small
                      onClick={() => nudge(id, list, -1)}
                      disabled={index === 0}
                      label={`Move ${card.name} up`}
                    >
                      Up
                    </Small>
                    <Small
                      onClick={() => nudge(id, list, 1)}
                      disabled={index === ids.length - 1}
                      label={`Move ${card.name} down`}
                    >
                      Down
                    </Small>
                    <Small
                      onClick={() =>
                        list === "onTrip"
                          ? moveTo(id, "waitlisted", lists.waitlisted.length)
                          : moveTo(id, "onTrip", lists.onTrip.length)
                      }
                      disabled={card.isPaid}
                      title={card.isPaid ? PAID_EXPLANATION : undefined}
                      label={
                        list === "onTrip"
                          ? `Move ${card.name} to the waitlist`
                          : `Move ${card.name} to the trip`
                      }
                    >
                      {list === "onTrip" ? "Move to waitlist" : "Move to trip"}
                    </Small>
                  </div>
                </div>
              </li>
            );
          })}

          <li>
            <Indicator active={drop?.list === list && drop.index === ids.length} />
          </li>
        </ul>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {over > 0 ? (
        <Notice tone="alert" title="More people than seats">
          {lists.onTrip.length} on the trip against a capacity of {capacity}. Move{" "}
          {over} {over === 1 ? "person" : "people"} to the waitlist before saving.
        </Notice>
      ) : null}

      {result ? (
        <Notice tone={result.ok ? "accent" : "alert"} title={result.ok ? "Saved" : "Not saved"}>
          {result.message}
        </Notice>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {column(
          "onTrip",
          `On the trip (${lists.onTrip.length}/${capacity})`,
          capacity - lists.onTrip.length > 0
            ? `${capacity - lists.onTrip.length} free`
            : over > 0
              ? `${over} over`
              : "Full",
        )}
        {column("waitlisted", "Waitlist", `${lists.waitlisted.length} waiting`)}
      </div>

      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <p className="text-sm text-ink-muted">
          {dirty
            ? "Unsaved changes. Nothing has been written and nobody has been told anything."
            : sendAction
              ? "The list is saved. Nobody has been told anything yet."
              : "No changes since the last save."}
        </p>
        <div className="flex gap-2">
          {dirty ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setLists(baseline);
                  announce("Changes discarded.");
                }}
                disabled={pending}
              >
                Reset
              </Button>
              <Button onClick={onSave} disabled={pending || over > 0}>
                {pending ? "Saving" : "Save order"}
              </Button>
            </>
          ) : (
            sendAction
          )}
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function Indicator({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className={cn("my-1 h-0.5 rounded", active ? "bg-accent" : "bg-transparent")}
    />
  );
}

function Small({
  children,
  onClick,
  disabled,
  title,
  label,
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className="h-7 px-2 text-xs"
    >
      {children}
    </Button>
  );
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
