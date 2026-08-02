export interface StripPhoto {
  id: string;
  url: string | null;
  alt: string;
}

/**
 * A few thumbnails and a count of the rest.
 *
 * This is the trip card's answer to "is there anything in here", which a bare
 * "12 photos" link does not really give. It replaced a stack of member avatars:
 * on a card that already names the trip and the people on it elsewhere, the
 * pictures are the thing worth a glance.
 *
 * Deliberately not a link. The card carries its own buttons, and a strip that
 * navigated as well would make most of the card a click target with two
 * different destinations depending on where the finger landed.
 *
 * Plain <img> for the same reason the avatars use one - these are signed R2 URLs
 * with a short life, and running them through the image optimiser would cache a
 * copy of a private photo outside the rules in lib/photos.ts.
 */
export function PhotoStrip({
  photos,
  total,
  tripTitle,
}: {
  photos: StripPhoto[];
  total: number;
  tripTitle: string;
}) {
  if (photos.length === 0) return null;

  const remaining = total - photos.length;

  return (
    <div
      role="img"
      aria-label={`${total} photo${total === 1 ? "" : "s"} from ${tripTitle}`}
      className="group flex items-center gap-1.5"
    >
      {photos.map((photo, index) => (
        <span
          key={photo.id}
          // The fan: hovering the strip splays the prints like a handful of
          // photographs. Pure delight, so it is short, alternating, and gone
          // entirely under reduced motion.
          className={`block h-11 w-11 shrink-0 overflow-hidden rounded-md border border-border bg-surface transition-transform duration-200 [transition-timing-function:var(--ease-soft)] motion-reduce:transition-none motion-reduce:group-hover:rotate-0 motion-reduce:group-hover:translate-y-0 group-hover:-translate-y-0.5 ${
            index % 2 === 0 ? "group-hover:-rotate-3" : "group-hover:rotate-3"
          }`}
        >
          {photo.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo.url}
              alt={photo.alt}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            // Storage not configured, or a signature that could not be made.
            // The tile still holds its place so the row does not reflow.
            <span aria-hidden="true" className="block h-full w-full" />
          )}
        </span>
      ))}

      {remaining > 0 ? (
        <span
          aria-hidden="true"
          className="tnum flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-xs font-medium text-ink-muted"
        >
          +{remaining}
        </span>
      ) : null}
    </div>
  );
}
