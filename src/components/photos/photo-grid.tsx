"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, cn } from "@/components/ui";

export interface PhotoView {
  id: string;
  /** The original; only the lightbox loads it. */
  url: string | null;
  /** The small copy the grid shows, when one has been made. */
  thumbUrl: string | null;
  caption: string | null;
  uploaderName: string;
  takenLabel: string;
  canRemove: boolean;
}

/**
 * Each download is its own navigation to a route that redirects to R2, and
 * firing forty at once makes a browser drop most of them silently.
 */
const DOWNLOAD_GAP_MS = 350;

/** When to look again for thumbnails the server is still making. */
const THUMBNAIL_CHECKS_MS = [8_000, 25_000];

/** Two rows on a desktop grid; everything below them waits to be scrolled to. */
const EAGER_TILES = 8;

/** Moves the lightbox by `delta`, stopping at either end. */
const stepWithin = (delta: number, count: number) => (index: number | null) =>
  index === null ? index : Math.min(Math.max(index + delta, 0), count - 1);

/**
 * The gallery. Signed URLs expire, so a removal ends in `router.refresh()`
 * rather than local state surgery - never show a member a dead image.
 */
export function PhotoGrid({ photos: allPhotos }: { photos: PhotoView[] }) {
  const router = useRouter();
  // Hidden the moment the server confirms a removal, rather than after the
  // refresh that re-renders the page round-trips.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const photos = useMemo(
    () => allPhotos.filter((photo) => !removedIds.has(photo.id)),
    [allPhotos, removedIds],
  );
  const refreshedFor = useRef<PhotoView[] | null>(null);

  // Missing thumbnails are made after this page was served; look again twice
  // so they replace the placeholders without the member reloading.
  const awaitingThumbnails = allPhotos.some((photo) => photo.url && !photo.thumbUrl);
  const thumbnailChecks = useRef(0);
  useEffect(() => {
    if (!awaitingThumbnails || thumbnailChecks.current >= THUMBNAIL_CHECKS_MS.length) return;
    const timer = setTimeout(() => {
      thumbnailChecks.current += 1;
      startTransition(() => router.refresh());
    }, THUMBNAIL_CHECKS_MS[thumbnailChecks.current]);
    return () => clearTimeout(timer);
  }, [awaitingThumbnails, allPhotos, router]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(new Set());
  const unmounted = useRef(false);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  useEffect(() => {
    if (openIndex === null) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenIndex(null);
      if (event.key === "ArrowRight") setOpenIndex(stepWithin(1, photos.length));
      if (event.key === "ArrowLeft") setOpenIndex(stepWithin(-1, photos.length));
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, photos.length]);

  function toggle(photoId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(photoId)) next.add(photoId);
      return next;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  async function remove(photoId: string) {
    if (!window.confirm("Remove this photo from the gallery?")) return;

    setRemoving(true);
    try {
      const response = await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
      if (response.ok) {
        setOpenIndex(null);
        setRemovedIds((current) => new Set(current).add(photoId));
        startTransition(() => router.refresh());
      }
    } finally {
      setRemoving(false);
    }
  }

  /**
   * One hidden iframe per photo, pointed at the download route. Not
   * `<a download>`: that attribute is ignored cross-origin and the file lives
   * on R2. Not `window.open`: a popup blocker stops the second one onwards.
   */
  async function download(ids: string[]) {
    setSaving({ done: 0, total: ids.length });

    for (let i = 0; i < ids.length && !unmounted.current; i++) {
      const frame = document.createElement("iframe");
      frame.style.display = "none";
      frame.src = `/api/photos/${ids[i]}/download`;
      document.body.appendChild(frame);
      window.setTimeout(() => frame.remove(), 60_000);

      setSaving({ done: i + 1, total: ids.length });
      await new Promise((resolve) => window.setTimeout(resolve, DOWNLOAD_GAP_MS));
    }

    setSaving(null);
  }

  if (photos.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface p-6 text-center text-sm text-ink-muted">
        No photos yet.
      </p>
    );
  }

  const active = openIndex === null ? null : photos[openIndex];
  const showOriginal = Boolean(active?.url && !failedUrls.has(active.url));

  /**
   * Signed URLs outlive neither a long-open page nor a browser that cannot
   * decode the file (HEIC outside Safari). Either way the image errors; ask
   * the server for fresh URLs once per failing URL. Inside the same signing
   * window they come back identical, so this costs a round trip, not a reload,
   * and a URL that failed for a real reason is not retried in a loop.
   */
  function imageFailed(url: string) {
    if (failedUrls.has(url)) return;
    setFailedUrls((current) => new Set(current).add(url));
    // One refresh per set of URLs the server handed down: a burst of failing
    // tiles (several HEIC photos, or a whole expired page) must not queue a
    // server render each.
    if (refreshedFor.current === allPhotos) return;
    refreshedFor.current = allPhotos;
    startTransition(() => router.refresh());
  }
  /**
   * Once the open photo has arrived, fetch the next original in the
   * background so the arrow key lands on a sharp image. One ahead only: each
   * is several megabytes.
   */
  function preloadOriginal(index: number) {
    const next = photos[index]?.url;
    if (next) new Image().src = next;
  }

  const allSelected = selected.size === photos.length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        {/* The count and the selection controls share one row. */}
        <p aria-live="polite" className="tnum mr-auto text-sm text-ink-muted">
          {!selecting
            ? `${photos.length} ${photos.length === 1 ? "photo" : "photos"}`
            : saving
              ? `Saving ${saving.done} of ${saving.total}`
              : `${selected.size} selected`}
        </p>
        {selecting ? (
          <>
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
              className="h-9 px-3 text-xs"
              disabled={selected.size === 0 || saving !== null}
              onClick={() =>
                void download(photos.filter((p) => selected.has(p.id)).map((p) => p.id))
              }
            >
              {selected.size > 0 ? `Download ${selected.size}` : "Download"}
            </Button>
            <Button
              variant="secondary"
              className="h-9 px-3 text-xs"
              disabled={saving !== null}
              onClick={stopSelecting}
            >
              Done
            </Button>
          </>
        ) : (
          <Button variant="secondary" className="h-9 px-3 text-xs" onClick={() => setSelecting(true)}>
            Select to download
          </Button>
        )}
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo, index) => {
          const isSelected = selected.has(photo.id);
          return (
            <li key={photo.id}>
              <button
                type="button"
                onClick={() => (selecting ? toggle(photo.id) : setOpenIndex(index))}
                aria-pressed={selecting ? isSelected : undefined}
                aria-label={
                  selecting
                    ? `${isSelected ? "Deselect" : "Select"} photo by ${photo.uploaderName}`
                    : `Open photo by ${photo.uploaderName}`
                }
                className={cn(
                  "relative block w-full overflow-hidden rounded-lg bg-surface",
                  isSelected ? "ring-2 ring-accent" : "ring-1 ring-border hover:ring-border-strong",
                )}
              >
                {/* Never the original in a tile: twenty phone originals are
                    hundreds of megapixels, and repainting them made every tap
                    and scroll stall for half a second. A tile waits for its
                    thumbnail instead; the lightbox still opens the original. */}
                {photo.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.thumbUrl}
                    onError={() => imageFailed(photo.thumbUrl!)}
                    alt={photo.caption ?? `Photo by ${photo.uploaderName}`}
                    // The first rows are on screen at once; waiting for layout
                    // to approve them only delays the first paint.
                    loading={index < EAGER_TILES ? "eager" : "lazy"}
                    fetchPriority={index < 4 ? "high" : undefined}
                    decoding="async"
                    className={cn("aspect-square w-full object-cover", isSelected && "opacity-80")}
                  />
                ) : (
                  <span className="flex aspect-square w-full items-center justify-center px-2 text-center text-xs text-ink-faint">
                    {photo.url ? "Preview coming" : "Unavailable"}
                  </span>
                )}
                {isSelected ? (
                  <span className="absolute left-2 top-2 rounded bg-accent px-1.5 py-0.5 text-xs font-semibold text-paper">
                    Selected
                  </span>
                ) : null}
              </button>
              <p className="mt-1.5 truncate text-xs text-ink-muted">{photo.uploaderName}</p>
            </li>
          );
        })}
      </ul>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          className="fixed inset-0 z-50 flex flex-col bg-paper/95 p-4"
          onClick={() => setOpenIndex(null)}
        >
          <div
            className="flex items-start justify-between gap-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{active.uploaderName}</p>
              <p className="text-xs text-ink-faint">{active.takenLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={saving !== null}
                onClick={() => void download([active.id])}
              >
                Download
              </Button>
              {active.canRemove ? (
                <Button variant="danger" disabled={removing} onClick={() => void remove(active.id)}>
                  {removing ? "Removing..." : "Remove photo"}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setOpenIndex(null)}>
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
              onClick={() => setOpenIndex(stepWithin(-1, photos.length))}
            >
              <span aria-hidden="true">&larr;</span>
            </Button>

            {showOriginal || active.thumbUrl ? (
              // Keyed per photo so the next photo never paints over the last
              // one's thumbnail. The thumbnail is already cached from the grid,
              // so it shows at once; the original paints over it when it lands.
              <div key={active.id} className="relative h-full min-w-0 flex-1">
                {active.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={active.thumbUrl}
                    alt={showOriginal ? "" : (active.caption ?? `Photo by ${active.uploaderName}`)}
                    aria-hidden={showOriginal || undefined}
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                ) : null}
                {showOriginal ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={active.url!}
                    alt={active.caption ?? `Photo by ${active.uploaderName}`}
                    onError={() => imageFailed(active.url!)}
                    onLoad={() => preloadOriginal(openIndex! + 1)}
                    // Decoding tens of megapixels must not hold up the frame
                    // that shows the thumbnail and the controls.
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                ) : null}
              </div>
            ) : (
              <p className="min-w-0 flex-1 text-center text-sm text-ink-muted">
                This photo cannot be shown here. Download has the original.
              </p>
            )}

            <Button
              variant="quiet"
              aria-label="Next photo"
              disabled={openIndex === photos.length - 1}
              onClick={() => setOpenIndex(stepWithin(1, photos.length))}
            >
              <span aria-hidden="true">&rarr;</span>
            </Button>
          </div>

          {!showOriginal && active.thumbUrl ? (
            <p className="pt-3 text-center text-xs text-ink-faint">
              Showing a preview. Download has the full-size photo.
            </p>
          ) : null}
          {active.caption ? (
            <p className="pt-3 text-center text-sm text-ink-muted">{active.caption}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
