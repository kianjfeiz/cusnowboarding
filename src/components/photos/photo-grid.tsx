"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, cn } from "@/components/ui";

export interface PhotoView {
  id: string;
  url: string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  uploaderName: string;
  /** Preformatted on the server so the browser's locale cannot disagree with it. */
  takenLabel: string;
  canRemove: boolean;
}

/**
 * Gap between saves in a batch.
 *
 * Each download is its own navigation to a route that redirects to R2, and
 * firing forty at once makes a browser drop most of them silently. Spacing them
 * also means the "Saving 12 of 40" counter is telling the truth rather than
 * finishing instantly while the browser catches up.
 */
const DOWNLOAD_GAP_MS = 350;

/**
 * The gallery.
 *
 * Signed URLs expire, so the page is rendered fresh on every visit and any
 * mutation ends in `router.refresh()` rather than in local state surgery. That
 * costs a round trip and buys never showing a member a dead image.
 *
 * Selection works the way a phone gallery has taught everyone it works: enter
 * select mode, then tap tiles or sweep across a run of them. The sweep applies
 * the FIRST tile's flip to everything it crosses - starting on an unselected
 * tile selects the run, starting on a selected one clears it - so a drag never
 * flickers tiles in and out as it passes back over them. On touch, the grid
 * keeps `pan-y`: vertical movement still scrolls a forty-photo page, and a
 * sideways sweep selects.
 */
export function PhotoGrid({ photos }: { photos: PhotoView[] }) {
  const router = useRouter();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** null when idle; otherwise how far through a batch we are. */
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);

  const cancelled = useRef(false);
  /** Present only mid-sweep: what to set crossed tiles to, and which are done. */
  const sweep = useRef<{ mode: boolean; visited: Set<string> } | null>(null);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const close = useCallback(() => setOpenIndex(null), []);

  const step = useCallback(
    (delta: number) => {
      setOpenIndex((current) => {
        if (current === null) return current;
        const next = current + delta;
        if (next < 0 || next >= photos.length) return current;
        return next;
      });
    },
    [photos.length],
  );

  useEffect(() => {
    if (openIndex === null) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, close, step]);

  const endSelecting = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  // Escape leaves select mode, matching the lightbox. Only when the lightbox is
  // closed, so one press does not tear down both.
  useEffect(() => {
    if (!selecting || openIndex !== null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") endSelecting();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, openIndex, endSelecting]);

  // A batch in flight outlives the click that started it, so an unmount has to
  // be able to stop it rather than keep navigating a page that is gone.
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const setOne = useCallback((photoId: string, mode: boolean) => {
    setSelected((current) => {
      if (current.has(photoId) === mode) return current;
      const next = new Set(current);
      if (mode) next.add(photoId);
      else next.delete(photoId);
      return next;
    });
  }, []);

  const tileAt = (x: number, y: number): string | null =>
    document.elementFromPoint(x, y)?.closest("[data-photo-id]")?.getAttribute("data-photo-id") ??
    null;

  const onSweepStart = useCallback(
    (event: React.PointerEvent) => {
      if (!selecting || saving) return;
      const id = tileAt(event.clientX, event.clientY);
      if (!id) return;
      const mode = !selectedRef.current.has(id);
      sweep.current = { mode, visited: new Set([id]) };
      setOne(id, mode);
    },
    [selecting, saving, setOne],
  );

  // Window-level, so a sweep that wanders off the grid keeps working until the
  // finger lifts, wherever that happens.
  useEffect(() => {
    if (!selecting) return;

    const move = (event: PointerEvent) => {
      const current = sweep.current;
      if (!current) return;
      const id = tileAt(event.clientX, event.clientY);
      if (id && !current.visited.has(id)) {
        current.visited.add(id);
        setOne(id, current.mode);
      }
    };
    const end = () => {
      sweep.current = null;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      sweep.current = null;
    };
  }, [selecting, setOne]);

  const remove = useCallback(
    async (photoId: string) => {
      if (!window.confirm("Remove this photo from the trip gallery?")) return;

      setRemoving(photoId);
      try {
        const response = await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
        if (response.ok) {
          setOpenIndex(null);
          setSelected((current) => {
            const next = new Set(current);
            next.delete(photoId);
            return next;
          });
          router.refresh();
        }
      } finally {
        setRemoving(null);
      }
    },
    [router],
  );

  /**
   * Saves photos by pointing a hidden iframe at the download route, one at a
   * time.
   *
   * Not `<a download>`: that attribute is ignored cross-origin, and the file
   * lives on R2. The route answers with a redirect to a signed URL carrying
   * `Content-Disposition: attachment`, which is what actually makes the browser
   * save rather than navigate. An iframe rather than `window.open` because a
   * popup blocker stops the second one onwards.
   */
  const download = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;

    setSaving({ done: 0, total: ids.length });

    for (let i = 0; i < ids.length; i++) {
      if (cancelled.current) break;

      const frame = document.createElement("iframe");
      frame.style.display = "none";
      frame.src = `/api/photos/${ids[i]}/download`;
      document.body.appendChild(frame);
      // The download is handed to the browser, not to this document, so the
      // frame has no further job once it has been asked.
      window.setTimeout(() => frame.remove(), 60_000);

      setSaving({ done: i + 1, total: ids.length });
      if (i < ids.length - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, DOWNLOAD_GAP_MS));
      }
    }

    // Left up briefly so a single save still reads as having happened.
    window.setTimeout(() => setSaving(null), 1200);
  }, []);

  if (photos.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface p-6 text-center text-sm text-ink-muted">
        No photos yet. If you took some, you are the person who can fix that.
      </p>
    );
  }

  const active = openIndex === null ? null : photos[openIndex];
  const allSelected = selected.size === photos.length;

  return (
    <>
      {!selecting ? (
        <div className="mb-3 flex justify-end">
          <Button
            variant="secondary"
            className="h-9 px-3 text-xs"
            onClick={() => setSelecting(true)}
          >
            Select
          </Button>
        </div>
      ) : null}

      <ul
        onPointerDown={onSweepStart}
        className={cn(
          "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4",
          selecting && "select-none",
        )}
        // pan-y, not none: vertical drag must keep scrolling a long gallery on
        // a phone. A sideways sweep is the selection gesture.
        style={selecting ? { touchAction: "pan-y" } : undefined}
      >
        {photos.map((photo, index) => {
          const isSelected = selected.has(photo.id);

          return (
            <li key={photo.id} data-photo-id={photo.id}>
              <button
                type="button"
                onClick={(event) => {
                  // Pointer taps were already handled at pointerdown by the
                  // sweep. detail === 0 is a keyboard "click", the one form of
                  // activation the sweep never sees.
                  if (!selecting) setOpenIndex(index);
                  else if (event.detail === 0) setOne(photo.id, !isSelected);
                }}
                aria-pressed={selecting ? isSelected : undefined}
                aria-label={
                  selecting
                    ? `${isSelected ? "Deselect" : "Select"} photo by ${photo.uploaderName}`
                    : `Open photo by ${photo.uploaderName}`
                }
                className={cn(
                  "relative block w-full overflow-hidden rounded-lg bg-surface",
                  "transition-all duration-200 ease-out motion-reduce:transition-none",
                  isSelected
                    ? // Picked up off the sheet: inset, ringed, and lifted.
                      "scale-[0.94] shadow-md ring-2 ring-accent"
                    : "ring-1 ring-border hover:ring-border-strong",
                )}
              >
                {photo.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.url}
                    alt={photo.caption ?? `Photo by ${photo.uploaderName}`}
                    loading="lazy"
                    draggable={false}
                    className={cn(
                      "aspect-square w-full object-cover",
                      "transition-transform duration-200 ease-out motion-reduce:transition-none",
                      isSelected && "scale-105",
                    )}
                  />
                ) : (
                  <span className="flex aspect-square w-full items-center justify-center text-xs text-ink-faint">
                    Unavailable
                  </span>
                )}

                {/* A wash over chosen tiles, so the state reads even before the
                    ring is in view. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-0 bg-accent/15",
                    "transition-opacity duration-200 motion-reduce:transition-none",
                    isSelected ? "opacity-100" : "opacity-0",
                  )}
                />

                {/*
                  Always mounted so it animates rather than appears. In select
                  mode every tile carries the empty circle - the invitation -
                  and the chosen ones fill in.
                */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                    "transition-all duration-200 ease-out motion-reduce:transition-none",
                    selecting ? "scale-100 opacity-100" : "scale-50 opacity-0",
                    isSelected
                      ? "bg-accent text-white shadow-sm"
                      : "border-2 border-paper/90 bg-ink/20 text-transparent",
                  )}
                >
                  &#10003;
                </span>
              </button>
              <p className="mt-1.5 truncate text-xs text-ink-muted">{photo.uploaderName}</p>
            </li>
          );
        })}
      </ul>

      {/*
        Everything about a selection lives on this one bar: leave, count, scope,
        act. Kept mounted and slid away rather than unmounted so it has
        something to animate from; `pointer-events-none` while hidden keeps it
        from swallowing taps on the last row of photos.
      */}
      <div
        className={cn(
          "sticky bottom-4 z-10 mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2",
          "rounded-xl border border-border bg-paper/95 px-3 py-2.5 shadow-lg backdrop-blur",
          "transition-all duration-200 ease-out motion-reduce:transition-none",
          selecting || saving
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-3 opacity-0",
        )}
        aria-hidden={!selecting && !saving}
      >
        <div className="flex items-center gap-1">
          <Button
            variant="quiet"
            aria-label="Done selecting"
            className="h-9 w-9 px-0"
            disabled={saving !== null}
            onClick={endSelecting}
          >
            <span aria-hidden="true">&#10005;</span>
          </Button>
          <p aria-live="polite" className="tnum text-sm text-ink">
            {saving
              ? `Saving ${saving.done} of ${saving.total}`
              : selected.size === 0
                ? "Tap or sweep across photos"
                : `${selected.size} selected`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="quiet"
            className="h-9 px-3 text-xs"
            disabled={saving !== null}
            onClick={() =>
              setSelected(allSelected ? new Set() : new Set(photos.map((p) => p.id)))
            }
          >
            {allSelected ? "Clear all" : "Select all"}
          </Button>
          <Button
            className="h-9 px-4"
            disabled={selected.size === 0 || saving !== null}
            onClick={() =>
              void download(photos.filter((p) => selected.has(p.id)).map((p) => p.id))
            }
          >
            {saving
              ? "Saving"
              : selected.size > 0
                ? `Download ${selected.size}`
                : "Download"}
          </Button>
        </div>
      </div>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          className="fixed inset-0 z-50 flex flex-col bg-paper/95 p-4"
          onClick={close}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{active.uploaderName}</p>
              <p className="text-xs text-ink-faint">{active.takenLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  void download([active.id]);
                }}
              >
                Download
              </Button>
              {active.canRemove ? (
                <Button
                  variant="danger"
                  disabled={removing === active.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void remove(active.id);
                  }}
                >
                  {removing === active.id ? "Removing..." : "Remove"}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={close}>
                Close
              </Button>
            </div>
          </div>

          <div
            className="flex min-h-0 flex-1 items-center justify-center gap-3 pt-4"
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              variant="quiet"
              aria-label="Previous photo"
              disabled={openIndex === 0}
              onClick={() => step(-1)}
            >
              <span aria-hidden="true">&larr;</span>
            </Button>

            {active.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={active.url}
                alt={active.caption ?? `Photo by ${active.uploaderName}`}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <p className="text-sm text-ink-muted">This photo could not be loaded.</p>
            )}

            <Button
              variant="quiet"
              aria-label="Next photo"
              disabled={openIndex === photos.length - 1}
              onClick={() => step(1)}
            >
              <span aria-hidden="true">&rarr;</span>
            </Button>
          </div>

          {active.caption ? (
            <p className="pt-3 text-center text-sm text-ink-muted">{active.caption}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
