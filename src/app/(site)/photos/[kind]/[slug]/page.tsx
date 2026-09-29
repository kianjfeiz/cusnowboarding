import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Notice, PageHeader, formatDenver } from "@/components/ui";
import { PhotoGrid } from "@/components/photos/photo-grid";
import { PhotoUploader } from "@/components/photos/photo-uploader";
import { resolvePhotoViewer } from "@/lib/photos/viewer";
import { canUsePhotos, getPhotoSubjectBySlug, listPhotos } from "@/lib/photos/photos";
import { isPhotoStorageConfigured } from "@/lib/photos/r2";

/** Signed URLs expire, so this page can never be cached or statically rendered. */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ kind: string; slug: string }> };

/** Serves /photos/trips/<slug> and /photos/events/<slug>; anything else is a 404. */
async function loadSubject({ params }: Params) {
  const { kind, slug } = await params;
  const type = kind === "trips" ? "trip" : kind === "events" ? "event" : null;
  return type ? getPhotoSubjectBySlug(type, slug) : null;
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const subject = await loadSubject(props);
  return {
    title: subject ? `Photos - ${subject.title}` : "Gallery not found",
    robots: { index: false, follow: false },
  };
}

/** One gallery, trip or event. Club-wide: any signed-in member may view and upload. */
export default async function GalleryPage(props: Params) {
  const subject = await loadSubject(props);
  if (!subject) notFound();

  const viewer = await resolvePhotoViewer();
  const photos = canUsePhotos(viewer) ? await listPhotos(subject, viewer) : null;

  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <PageHeader back="/photos" backLabel="Photos" title={subject.title}>
        <p className="mt-2 text-sm text-ink-muted">
          {formatDenver(subject.startsAt)}
          {subject.place ? ` · ${subject.place}` : ""}
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
            <PhotoUploader subject={{ type: subject.type, id: subject.id }} />
          ) : (
            <Notice title="Photo uploads are not set up yet" />
          )}

          <section>
            <PhotoGrid
              photos={photos.map((photo) => ({
                id: photo.id,
                url: photo.url,
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
