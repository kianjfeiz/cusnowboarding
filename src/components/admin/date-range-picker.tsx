"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DAY_LABELS,
  MONTHS,
  type Parts,
  dayKey,
  formatDay,
  formatTime,
  monthGrid,
  pad,
  parseValue,
  shiftedMonth,
  toValue,
} from "./date-parts";

/**
 * Departure and return picked as one range, the way a flight search does it.
 *
 * They were two independent calendars, which made the board pick a month twice
 * for what is a single decision, and offered no hint that the second date must
 * follow the first - the only feedback for getting it backwards was a form
 * error after saving. Here the second click can only land on or after the
 * first, so the invalid case is unreachable rather than rejected.
 *
 * Two months are shown side by side from `sm` up, because a trip that crosses a
 * month boundary is otherwise a paging exercise mid-selection. On a phone there
 * is only room for one.
 *
 * Times stay separate per end of the range: a trip leaves early and comes back
 * late, and those two clocks have nothing to do with each other.
 */

const DEFAULT_DEPART_HOUR = 6;
const DEFAULT_RETURN_HOUR = 18;

type Phase = "start" | "end";

export function DateRangePicker({
  startName,
  endName,
  startDefault = "",
  endDefault = "",
}: {
  startName: string;
  endName: string;
  startDefault?: string;
  endDefault?: string;
}) {
  const [start, setStart] = useState<Parts | null>(() => parseValue(startDefault));
  const [end, setEnd] = useState<Parts | null>(() => parseValue(endDefault));
  const [phase, setPhase] = useState<Phase>("start");
  const [hover, setHover] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const today = new Date();
  const [viewYear, setViewYear] = useState(start?.year ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(start?.month ?? today.getMonth());

  const wrapRef = useRef<HTMLDivElement>(null);

  // Click-outside and Escape both close, same as the single picker. A control
  // that traps the board mid-form is worse than the native one it replaces.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const startKey = start ? dayKey(start.year, start.month, start.day) : null;
  const endKey = end ? dayKey(end.year, end.month, end.day) : null;

  function openOn(next: Phase) {
    setPhase(next);
    // Jump the calendar to whichever end is being edited, so the relevant
    // month is on screen rather than wherever it was left.
    const anchor = next === "end" ? (end ?? start) : start;
    if (anchor) {
      setViewYear(anchor.year);
      setViewMonth(anchor.month);
    }
    setOpen(true);
  }

  function pickDay(year: number, month: number, day: number) {
    const key = dayKey(year, month, day);

    /*
      `phase` decides what a click means, rather than the state of the range.
      That is what lets the Returns field be clicked on a finished range to
      re-pick just the return, instead of the click being read as the start of
      a new one - and it keeps a click landing before the departure from
      producing a backwards range, since it falls through to starting over.
    */
    const settingEnd = phase === "end" && startKey !== null && key >= startKey;

    if (settingEnd) {
      setEnd({
        year,
        month,
        day,
        hour: end?.hour ?? DEFAULT_RETURN_HOUR,
        minute: end?.minute ?? 0,
      });
      setPhase("start");
      return;
    }

    setStart({
      year,
      month,
      day,
      hour: start?.hour ?? DEFAULT_DEPART_HOUR,
      minute: start?.minute ?? 0,
    });
    setEnd(null);
    setPhase("end");
  }

  function setTime(which: Phase, time: string) {
    const [h, m] = time.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    if (which === "start") {
      setStart((p) => (p ? { ...p, hour: h, minute: m } : p));
    } else {
      setEnd((p) => (p ? { ...p, hour: h, minute: m } : p));
    }
  }

  function clear() {
    setStart(null);
    setEnd(null);
    setPhase("start");
    setHover(null);
  }

  /**
   * While the return is being chosen, the day under the cursor stands in for
   * it, so the shaded band answers "how long is this trip" before committing.
   */
  const previewKey = phase === "end" && startKey !== null ? hover : null;
  // The hovered day wins while it is being previewed, so re-picking a return
  // shows the band it would become rather than the one it currently is.
  const bandEnd = previewKey ?? endKey;

  const nights = useMemo(() => {
    if (!start || !end) return null;
    const a = Date.UTC(start.year, start.month, start.day);
    const b = Date.UTC(end.year, end.month, end.day);
    return Math.round((b - a) / 86_400_000);
  }, [start, end]);

  const second = shiftedMonth(viewYear, viewMonth, 1);

  return (
    <div className="relative" ref={wrapRef}>
      <input type="hidden" name={startName} value={start ? toValue(start) : ""} />
      <input type="hidden" name={endName} value={end ? toValue(end) : ""} />

      <div className="grid gap-3 sm:grid-cols-2">
        <FieldButton
          label="Departs"
          parts={start}
          placeholder="Pick a date"
          active={open && phase === "start"}
          onClick={() => openOn("start")}
        />
        <FieldButton
          label="Returns"
          parts={end}
          placeholder={start ? "Pick a date" : "Departure first"}
          active={open && phase === "end"}
          onClick={() => openOn("end")}
        />
      </div>

      {open ? (
        <div
          /*
            The two fields sit side by side from `sm` up but stack on a phone,
            so the popover has to clear a taller block there or it opens on top
            of the very field being edited.
          */
          className="absolute left-0 top-[8.25rem] z-20 w-[19rem] max-w-[calc(100vw-3.5rem)] rounded-lg border border-border-strong bg-paper p-3 shadow-lg sm:top-[4.5rem] sm:w-[36rem]"
          onMouseLeave={() => setHover(null)}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                const p = shiftedMonth(viewYear, viewMonth, -1);
                setViewYear(p.year);
                setViewMonth(p.month);
              }}
              aria-label="Previous month"
              className="h-9 w-9 rounded text-ink-muted hover:bg-surface hover:text-ink sm:h-7 sm:w-7"
            >
              &lt;
            </button>
            <p className="text-sm text-ink-muted">
              {phase === "end" && start ? "Pick the return" : "Pick the departure"}
            </p>
            <button
              type="button"
              onClick={() => {
                const n = shiftedMonth(viewYear, viewMonth, 1);
                setViewYear(n.year);
                setViewMonth(n.month);
              }}
              aria-label="Next month"
              className="h-9 w-9 rounded text-ink-muted hover:bg-surface hover:text-ink sm:h-7 sm:w-7"
            >
              &gt;
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Month
              year={viewYear}
              month={viewMonth}
              today={today}
              startKey={startKey}
              endKey={endKey}
              bandEnd={bandEnd}
              onPick={pickDay}
              onHover={setHover}
            />
            {/* Second month only where there is room for it. */}
            <div className="hidden sm:block">
              <Month
                year={second.year}
                month={second.month}
                today={today}
                startKey={startKey}
                endKey={endKey}
                bandEnd={bandEnd}
                onPick={pickDay}
                onHover={setHover}
              />
            </div>
          </div>

          <div className="mt-3 space-y-2 border-t border-border pt-3 sm:flex sm:items-end sm:gap-3 sm:space-y-0">
            <TimeField
              id={`${startName}-time`}
              label="Leaves"
              parts={start}
              onChange={(v) => setTime("start", v)}
            />
            <TimeField
              id={`${endName}-time`}
              label="Returns"
              parts={end}
              onChange={(v) => setTime("end", v)}
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-10 w-full rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover sm:h-8 sm:w-auto"
            >
              Done
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-ink-faint">
              {nights === null
                ? " "
                : nights === 0
                  ? "Day trip"
                  : `${nights} night${nights === 1 ? "" : "s"}`}
            </p>
            {start || end ? (
              <button
                type="button"
                onClick={clear}
                className="rounded px-2 py-2 text-xs text-ink-muted hover:bg-surface hover:text-ink sm:py-1"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FieldButton({
  label,
  parts,
  placeholder,
  active,
  onClick,
}: {
  label: string;
  parts: Parts | null;
  placeholder: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-14 w-full rounded-md border bg-paper px-3 text-left transition-colors",
        active ? "border-accent" : "border-border hover:border-border-strong",
      ].join(" ")}
    >
      <span className="block text-xs text-ink-muted">{label}</span>
      {parts ? (
        <span className="block text-sm text-ink">
          {formatDay(parts)}
          <span className="text-ink-muted"> · {formatTime(parts)}</span>
        </span>
      ) : (
        <span className="block text-sm text-ink-faint">{placeholder}</span>
      )}
    </button>
  );
}

function TimeField({
  id,
  label,
  parts,
  onChange,
}: {
  id: string;
  label: string;
  parts: Parts | null;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex-1">
      <label className="mb-1 block text-xs text-ink-muted" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="time"
        disabled={!parts}
        value={parts ? `${pad(parts.hour)}:${pad(parts.minute)}` : ""}
        onChange={(e) => onChange(e.target.value)}
        className="tnum h-10 w-full rounded border border-border bg-paper px-2 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-50 sm:h-8"
      />
    </div>
  );
}

function Month({
  year,
  month,
  today,
  startKey,
  endKey,
  bandEnd,
  onPick,
  onHover,
}: {
  year: number;
  month: number;
  today: Date;
  startKey: number | null;
  endKey: number | null;
  bandEnd: number | null;
  onPick: (year: number, month: number, day: number) => void;
  onHover: (key: number | null) => void;
}) {
  const grid = monthGrid(year, month);

  return (
    <div>
      <p className="mb-1 text-center text-sm font-medium">
        {MONTHS[month]} {year}
      </p>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {DAY_LABELS.map((d) => (
          <div key={d} className="py-1 text-xs text-ink-faint">
            {d}
          </div>
        ))}
        {grid.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />;

          const key = dayKey(year, month, day);
          const isStart = key === startKey;
          const isEnd = key === endKey;
          const inBand =
            startKey !== null && bandEnd !== null && key > Math.min(startKey, bandEnd) && key < Math.max(startKey, bandEnd);
          const isToday =
            year === today.getFullYear() && month === today.getMonth() && day === today.getDate();

          return (
            <button
              key={day}
              type="button"
              onClick={() => onPick(year, month, day)}
              onMouseEnter={() => onHover(key)}
              className={[
                "tnum h-10 text-sm transition-colors sm:h-8",
                // Square ends on the inside so the band reads as one bar.
                isStart && endKey !== null ? "rounded-l" : "",
                isEnd ? "rounded-r" : "",
                !isStart && !isEnd && !inBand ? "rounded" : "",
                isStart || isEnd
                  ? "bg-accent font-medium text-white"
                  : inBand
                    ? "bg-accent-soft text-ink"
                    : isToday
                      ? "rounded bg-surface-strong text-ink"
                      : "rounded text-ink hover:bg-surface",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
