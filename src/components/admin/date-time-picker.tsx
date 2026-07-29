"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A month-grid date picker with a time field, replacing `datetime-local`.
 *
 * The native control renders completely differently in Chrome, Safari and
 * Firefox, and on a drop night the board is reading these values back under
 * time pressure - a consistent, legible control is worth the code.
 *
 * The value format is unchanged (`YYYY-MM-DDTHH:mm`), so the server actions
 * parsing these fields need no changes: a hidden input carries exactly what the
 * native control would have submitted. All values are Mountain Time, which is
 * what the surrounding form says and what parseDenverInput expects.
 */

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Parts {
  year: number;
  month: number; // 0-indexed
  day: number;
  hour: number;
  minute: number;
}

function parseValue(value: string): Parts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]) - 1,
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

function toValue(p: Parts): string {
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function formatDisplay(p: Parts | null): string {
  if (!p) return "";
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const suffix = p.hour < 12 ? "AM" : "PM";
  return `${MONTHS[p.month].slice(0, 3)} ${p.day}, ${p.year} at ${h12}:${pad(p.minute)} ${suffix}`;
}

/** Days shown in the grid, including the leading blanks for alignment. */
function monthGrid(year: number, month: number): Array<number | null> {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: count }, (_, i) => i + 1),
  ];
}

export function DateTimePicker({
  name,
  defaultValue = "",
  required = false,
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const parts = useMemo(() => parseValue(value), [value]);

  const today = new Date();
  const [viewYear, setViewYear] = useState(parts?.year ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parts?.month ?? today.getMonth());

  const wrapRef = useRef<HTMLDivElement>(null);

  // Click-outside and Escape both close. A picker that traps the board mid-form
  // is worse than the native control it replaces.
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

  function pickDay(day: number) {
    const next: Parts = {
      year: viewYear,
      month: viewMonth,
      day,
      // Default a fresh date to 20:00, the usual drop time, rather than
      // midnight - which is never what anyone means and is easy not to notice.
      hour: parts?.hour ?? 20,
      minute: parts?.minute ?? 0,
    };
    setValue(toValue(next));
  }

  function setTime(time: string) {
    const [h, m] = time.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const base = parts ?? {
      year: viewYear,
      month: viewMonth,
      day: today.getDate(),
      hour: 20,
      minute: 0,
    };
    setValue(toValue({ ...base, hour: h, minute: m }));
  }

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth());
  }

  const grid = monthGrid(viewYear, viewMonth);
  const isToday = (d: number) =>
    viewYear === today.getFullYear() &&
    viewMonth === today.getMonth() &&
    d === today.getDate();
  const isPicked = (d: number) =>
    parts !== null && parts.year === viewYear && parts.month === viewMonth && parts.day === d;

  return (
    <div className="relative" ref={wrapRef}>
      <input type="hidden" name={name} value={value} required={required} />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-10 w-full rounded-md border border-border bg-paper px-3 text-left text-sm text-ink hover:border-border-strong focus:border-accent focus:outline-none"
      >
        {parts ? (
          formatDisplay(parts)
        ) : (
          <span className="text-ink-faint">Pick a date and time</span>
        )}
      </button>

      {open ? (
        <div className="absolute left-0 top-11 z-20 w-72 rounded-lg border border-border-strong bg-paper p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="h-7 w-7 rounded text-ink-muted hover:bg-surface hover:text-ink"
            >
              &lt;
            </button>
            <span className="text-sm font-medium">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="h-7 w-7 rounded text-ink-muted hover:bg-surface hover:text-ink"
            >
              &gt;
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center">
            {DAY_LABELS.map((d) => (
              <div key={d} className="py-1 text-xs text-ink-faint">
                {d}
              </div>
            ))}
            {grid.map((day, i) =>
              day === null ? (
                <div key={`blank-${i}`} />
              ) : (
                <button
                  key={day}
                  type="button"
                  onClick={() => pickDay(day)}
                  className={[
                    "tnum h-8 rounded text-sm transition-colors",
                    isPicked(day)
                      ? "bg-accent font-medium text-white"
                      : isToday(day)
                        ? "bg-surface-strong text-ink"
                        : "text-ink hover:bg-surface",
                  ].join(" ")}
                >
                  {day}
                </button>
              ),
            )}
          </div>

          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <label className="text-xs text-ink-muted" htmlFor={`${name}-time`}>
              Time
            </label>
            <input
              id={`${name}-time`}
              type="time"
              value={parts ? `${pad(parts.hour)}:${pad(parts.minute)}` : ""}
              onChange={(e) => setTime(e.target.value)}
              className="tnum h-8 flex-1 rounded border border-border bg-paper px-2 text-sm text-ink focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover"
            >
              Done
            </button>
          </div>

          {value ? (
            <button
              type="button"
              onClick={() => setValue("")}
              className="mt-2 w-full rounded py-1 text-xs text-ink-muted hover:bg-surface hover:text-ink"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
