"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Detail, cn } from "@/components/ui";
import type { CalendarItemView } from "./view";

/**
 * A calendar entry and the panel it opens. The native `<dialog>` provides
 * Escape-to-close and the focus trap; the panel unmounts on close, so focus is
 * handed back to the trigger explicitly.
 */
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

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
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
                "transition-colors hover:border-border-strong",
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
            <span
              aria-hidden="true"
              className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
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

            <dl className="mt-4 space-y-3">
              <Detail label="When">{item.whenLabel}</Detail>

              {item.locationName || item.address ? (
                <Detail label="Where">
                  {item.locationName ? <span className="block">{item.locationName}</span> : null}
                  {item.address ? <span className="block text-ink-muted">{item.address}</span> : null}
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
                </Detail>
              ) : null}

              {item.description ? (
                <Detail label="Details">
                  <span className="whitespace-pre-line text-ink-muted">{item.description}</span>
                </Detail>
              ) : null}
            </dl>

            <div className="mt-6 flex items-center gap-4">
              <Button variant="secondary" onClick={close}>
                Close
              </Button>
              {item.href ? (
                <Link href={item.href} className="text-sm text-accent underline underline-offset-4">
                  Open trip page
                </Link>
              ) : null}
            </div>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
