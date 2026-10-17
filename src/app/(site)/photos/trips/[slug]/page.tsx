import { cache } from "react";
import { notFound } from "next/navigation";
import { after } from "next/server";
import type { Metadata } from "next";
import { Notice, PageHeader, formatDenver } from "@/components/ui";
import { PhotoGrid } from "@/components/photos/photo-grid";
import { PhotoUploader } from "@/components/photos/photo-uploader";
import { resolvePhotoViewer } from "@/lib/photos/viewer";
import { canUsePhotos, getGalleryTripBySlug, listPhotos } from "@/lib/photos/photos";
import { isPhotoStorageConfigured } from "@/lib/photos/r2";
import { generateThumbnails } from "@/lib/photos/thumbnails";

/** Signed URLs expire, so this page can never be cached or statically rendered. */
export const dynamic = "force-dynamic";

/** Room for the thumbnail work scheduled with after() to finish on a trip's first view. */
export const maxDuration = 60;

type Params = { params: Promise<{ slug: string }> };

/** The metadata and the page both need the trip; one query serves both. */
const loadTrip = cache(getGalleryTripBySlug);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const trip = await loadTrip((await params).slug);
  return {
    title: trip ? `Photos - ${trip.title}` : "Gallery not found",
    robots: { index: false, follow: false },
  };
}

/** One trip's gallery. Club-wide: any signed-in member may view and upload. */
export default async function GalleryPage({ params }: Params) {
  // Independent lookups, so neither waits on the other's round trip.
  const [trip, viewer] = await Promise.all([loadTrip((await params).slug), resolvePhotoViewer()]);
  if (!trip) notFound();

  const photos = canUsePhotos(viewer) ? await listPhotos(trip.id, viewer) : null;

  // Photos from before thumbnails existed get theirs after the page has gone
  // out; until then the grid falls back to the original.
  const missing = photos?.filter((photo) => !photo.thumbUrl).map((photo) => photo.id) ?? [];
  if (missing.length > 0) after(() => generateThumbnails(missing));

  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <PageHeader back="/photos" backLabel="Photos" title={trip.title}>
        <p className="mt-2 text-sm text-ink-muted">
          {formatDenver(trip.startsAt)}
          {trip.place ? ` · ${trip.place}` : ""}
        </p>
      </PageHeader>

      {photos === null ? (
        // Only reachable when a session exists without a member behind it.
        <Notice title="Sign in to see photos">
          Galleries are for club members. Sign in with the CU address you use
          for the club and reload this page.
        </Notice>
      ) : (
        <div className="space-y-8">
          {isPhotoStorageConfigured() ? (
            <PhotoUploader tripId={trip.id} />
          ) : (
            <Notice title="Photo uploads are not set up yet" />
          )}

          <section>
            <PhotoGrid
              photos={photos.map((photo) => ({
                id: photo.id,
                url: photo.url,
                thumbUrl: photo.thumbUrl,
                caption: photo.caption,
                uploaderName: photo.uploaderName,
                // Formatted here so the browser's locale cannot disagree with it.
                takenLabel: formatDenver(photo.takenAt ?? photo.createdAt),
                canRemove: photo.canRemove,
              }))}
            />
          </section>

          <p className="text-xs text-ink-faint">Club members only. Please do not repost publicly.</p>
        </div>
      )}
    </main>
  );
}
