"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

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
 * The gallery.
 *
 * Signed URLs expire, so the page is rendered fresh on every visit and any
 * mutation ends in `router.refresh()` rather than in local state surgery. That
 * costs a round trip and buys never showing a member a dead image.
 */
export function PhotoGrid({ photos }: { photos: PhotoView[] }) {
  const router = useRouter();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

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

  const remove = useCallback(
    async (photoId: string) => {
      if (!window.confirm("Remove this photo from the trip gallery?")) return;

      setRemoving(photoId);
      try {
        const response = await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
        if (response.ok) {
          setOpenIndex(null);
          router.refresh();
        }
      } finally {
        setRemoving(null);
      }
    },
    [router],
  );

  if (photos.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface p-6 text-center text-sm text-ink-muted">
        No photos yet. If you took some, you are the person who can fix that.
      </p>
    );
  }

  const active = openIndex === null ? null : photos[openIndex];

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo, index) => (
          <li key={photo.id}>
            <button
              type="button"
              onClick={() => setOpenIndex(index)}
              className="block w-full overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-border-strong"
            >
              {photo.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.url}
                  alt={photo.caption ?? `Photo by ${photo.uploaderName}`}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <span className="flex aspect-square w-full items-center justify-center text-xs text-ink-faint">
                  Unavailable
                </span>
              )}
            </button>
            <p className="mt-1.5 truncate text-xs text-ink-muted">{photo.uploaderName}</p>
          </li>
        ))}
      </ul>

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
