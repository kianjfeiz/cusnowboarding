import Link from "next/link";
import { DAY_ONLY, formatDenver } from "@/components/ui";
import { PREVIEW_COUNT, type GalleryTripCard } from "@/lib/photos/photos";

function photoCountLabel(count: number) {
  if (count === 0) return "No photos yet";
  return `${count} photo${count === 1 ? "" : "s"}`;
}

export function TripTile({ trip }: { trip: GalleryTripCard }) {
  return (
    <Link
      href={`/photos/trips/${trip.slug}`}
      className="block rounded-lg border border-border bg-paper p-3 transition-colors hover:border-border-strong"
    >
      {/* Always every slot, so tiles line up however full their galleries are. */}
      <div aria-hidden className="grid grid-cols-4 gap-1">
        {Array.from({ length: PREVIEW_COUNT }, (_, i) => {
          const photo = trip.preview[i];
          return photo?.url && !photo.needsThumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.id}
              src={photo.url}
              alt=""
              loading="lazy"
              decoding="async"
              className="aspect-square w-full rounded bg-surface object-cover"
            />
          ) : (
            <div key={photo?.id ?? `empty-${i}`} className="aspect-square rounded bg-surface" />
          );
        })}
      </div>

      <div className="px-1 pb-1 pt-3">
        <h2 className="truncate font-semibold tracking-tight text-ink">{trip.title}</h2>
        <p className="mt-0.5 truncate text-sm text-ink-muted">
          {formatDenver(trip.startsAt, DAY_ONLY)}
          {trip.place ? ` · ${trip.place}` : ""}
        </p>
        <p className="tnum text-sm text-ink-muted">{photoCountLabel(trip.photoCount)}</p>
      </div>
    </Link>
  );
}
