"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Badge, cn } from "@/components/ui";
import type { CalendarItemView } from "./view";

/**
 * A calendar entry and the panel it opens.
 *
 * Built on the native `<dialog>` with `showModal()`, which is what provides
 * Escape-to-close and the focus trap without shipping a library for it. The
 * things the platform does not do - restoring focus to the trigger on every
 * close path, and wrapping Tab at the ends - are done explicitly below.
 */

function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export function CalendarEntry({
  item,
  variant = "cell",
}: {
  item: CalendarItemView;
  variant?: "cell" | "row";
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;

    const focusable = focusableWithin(dialogRef.current);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === "cell"
            ? "block w-full rounded px-1 py-0.5 text-left text-xs text-ink transition-colors hover:bg-surface-strong"
            : cn(
                "group flex w-full items-center gap-4 rounded-lg border border-border bg-paper px-4 py-3 text-left",
                "transition-[border-color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-soft)]",
                "hover:-translate-y-0.5 hover:border-border-strong hover:shadow-sm",
                "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
              )
        }
      >
        {variant === "cell" ? (
          <>
            <span className="tnum block text-ink-faint">{item.timeLabel}</span>
            <span className="block truncate font-medium">{item.title}</span>
          </>
        ) : (
          <>
            {/* A tear-off-calendar tile: the date is the first thing a member
                scans a list of events for, so it gets the shape of a date. */}
            <span className="flex w-12 shrink-0 flex-col items-center rounded-md border border-border bg-surface py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                {item.monthShort}
              </span>
              <span className="tnum text-lg font-semibold leading-tight text-ink">
                {item.dayNum}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-ink">{item.title}</span>
              <span className="mt-0.5 block text-sm text-ink-muted">
                {item.timeLabel}
                {item.locationName ? ` at ${item.locationName}` : ""}
              </span>
            </span>
            <Badge emphasis="muted">{item.kindLabel}</Badge>
            {/* Slides in on hover: the row's answer to "can I do something
                here". Hidden from screen readers - the row is already a
                button. */}
            <span
              aria-hidden="true"
              className="-translate-x-1 text-ink-faint opacity-0 transition-[transform,opacity] duration-200 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none"
            >
              &rarr;
            </span>
          </>
        )}
      </button>

      {open ? (
        <dialog
          ref={dialogRef}
          onClose={close}
          onKeyDown={onKeyDown}
          onClick={(event) => {
            // A click that lands on the dialog element itself is a click on the
            // backdrop; anything inside is a click on the panel.
            if (event.target === dialogRef.current) close();
          }}
          aria-labelledby={`calendar-item-title-${item.key}`}
          className={cn(
            "m-auto max-h-[85vh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto",
            "rounded-lg border border-border bg-paper p-0",
            "text-ink backdrop:bg-ink/40",
          )}
        >
          <div className="p-6">
            <p className="text-xs uppercase tracking-wide text-ink-faint">{item.kindLabel}</p>
            <h2
              id={`calendar-item-title-${item.key}`}
              className="mt-1 text-lg font-semibold tracking-tight"
            >
              {item.title}
            </h2>

            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-faint">When</dt>
                <dd className="mt-0.5 text-ink">{item.whenLabel}</dd>
              </div>

              {item.locationName || item.address ? (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-faint">Where</dt>
                  <dd className="mt-0.5 text-ink">
                    {item.locationName ? <span className="block">{item.locationName}</span> : null}
                    {item.address ? (
                      <span className="block text-ink-muted">{item.address}</span>
                    ) : null}
                    {item.mapUrl ? (
                      <a
                        href={item.mapUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-block text-accent underline underline-offset-4"
                      >
                        Open in maps
                      </a>
                    ) : null}
                  </dd>
                </div>
              ) : null}

              {item.description ? (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-faint">Details</dt>
                  <dd className="mt-0.5 whitespace-pre-line text-ink-muted">{item.description}</dd>
                </div>
              ) : null}
            </dl>

            {item.isTwentyOnePlus ? (
              <p className="mt-4 rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink">
                21 and over.
              </p>
            ) : null}

            <div className="mt-6 flex items-center gap-4">
              <button
                type="button"
                onClick={close}
                className="inline-flex h-9 items-center rounded-md border border-border-strong bg-paper px-3 text-sm font-medium text-ink transition-colors hover:bg-surface"
              >
                Close
              </button>
              {item.href ? (
                <Link
                  href={item.href}
                  className="text-sm text-accent underline underline-offset-4"
                >
                  Trip details
                </Link>
              ) : null}
            </div>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
