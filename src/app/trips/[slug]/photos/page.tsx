import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card, Notice, formatDenver } from "@/components/ui";
import { PhotoGrid, type PhotoView } from "@/components/photos/photo-grid";
import { PhotoUploader } from "@/components/photos/photo-uploader";
import { resolvePhotoViewer } from "@/app/api/photos/_viewer";
import {
  canUploadTripPhotos,
  canViewerSeeTripPhotos,
  listTripPhotos,
  type PhotoViewer,
} from "@/lib/photos";
import { isPhotoStorageConfigured } from "@/lib/storage/r2";
import { getTripBySlug } from "@/lib/trips";

/** Signed URLs expire, so this page can never be cached or statically rendered. */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const trip = await getTripBySlug((await params).slug);
  return {
    title: trip ? `Photos - ${trip.title}` : "Trip not found",
    // These are pictures of students on a private trip. Nothing about this page
    // belongs in a search index, whatever the access rules already prevent.
    robots: { index: false, follow: false },
  };
}

export default async function TripPhotosPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const trip = await getTripBySlug(slug);
  if (!trip || trip.status === "draft") notFound();

  const viewer = await resolvePhotoViewer();
  const entitled = await canViewerSeeTripPhotos(viewer, trip.id);

  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <header className="mb-8">
        <Link
          href={`/trips/${trip.slug}`}
          className="-my-2 inline-flex items-center gap-1.5 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <span aria-hidden="true">&larr;</span> {trip.title}
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Photos</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {formatDenver(trip.departAt)}
          {trip.resort ? ` - ${trip.resort}` : ""}
        </p>
      </header>

      {entitled ? (
        <EntitledView tripId={trip.id} viewer={viewer} />
      ) : (
        /**
         * Deliberately not a 404. The trip page beside this one is public, so
         * pretending the gallery does not exist would only confuse a member who
         * was on a different trip. Saying plainly who it is for reveals nothing
         * that the roster does not already.
         */
        <Notice title="This gallery is for the people who were on the trip">
          Photos for this trip are only visible to people who were on it, plus the
          board. If you went and this is not what you expected, make sure you are
          signed in with the address you used to sign up.
        </Notice>
      )}
    </main>
  );
}

async function EntitledView({ tripId, viewer }: { tripId: string; viewer: PhotoViewer }) {
  const [photos, canUpload] = await Promise.all([
    listTripPhotos(tripId, viewer),
    canUploadTripPhotos(viewer.memberId, tripId),
  ]);

  const storageReady = isPhotoStorageConfigured();

  const views: PhotoView[] = photos.map((photo) => ({
    id: photo.id,
    url: photo.url,
    width: photo.width,
    height: photo.height,
    caption: photo.caption,
    uploaderName: photo.uploaderName,
    takenLabel: formatDenver(photo.takenAt ?? photo.createdAt),
    canRemove: photo.canRemove,
  }));

  return (
    <div className="space-y-8">
      {canUpload && storageReady ? <PhotoUploader tripId={tripId} /> : null}

      {canUpload && !storageReady ? (
        <Notice title="Uploads are not switched on yet">
          Photo storage has not been configured for this deployment, so there is
          nowhere to put a file. The board needs to set the R2 keys.
        </Notice>
      ) : null}

      {!canUpload ? (
        <Card className="text-sm text-ink-muted">
          You are seeing this gallery as a board member. Uploads are limited to
          people who were on the trip.
        </Card>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">
          {views.length} {views.length === 1 ? "photo" : "photos"}
        </h2>
        <PhotoGrid photos={views} />
      </section>

      <p className="text-xs text-ink-faint">
        These photos are shared only with the people who were on this trip and the
        board. Do not repost them anywhere the whole club can see.
      </p>
    </div>
  );
}
