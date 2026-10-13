import type { Metadata } from "next";
import { Card, Notice } from "@/components/ui";
import { TripTile } from "@/components/photos/trip-tile";
import { resolvePhotoViewer } from "@/lib/photos/viewer";
import { canUsePhotos, listGalleryTrips } from "@/lib/photos/photos";

/** Counts change as people upload, and preview URLs are signed; never cache. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Photos - CU Snowboarding",
  robots: { index: false, follow: false },
};

/**
 * One tile per trip that has departed, listed even with zero photos: the empty
 * gallery is the invitation. Trips still ahead have nothing to show, so they
 * wait until their day. Events do not get galleries.
 */
export default async function PhotosPage() {
  const viewer = await resolvePhotoViewer();
  const now = Date.now();
  const trips = canUsePhotos(viewer)
    ? (await listGalleryTrips(viewer)).filter((trip) => trip.startsAt.getTime() <= now)
    : null;

  return (
    <main className="mx-auto max-w-7xl px-5 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Photos</h1>
      </header>

      {trips === null ? (
        // Only reachable when a session exists without a member behind it.
        <Notice title="Sign in to see photos">
          Galleries are for club members. Sign in with the CU address you use
          for the club and reload this page.
        </Notice>
      ) : trips.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No galleries yet - each trip gets one here once it has left.
          </p>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {trips.map((trip) => (
            <li key={trip.id}>
              <TripTile trip={trip} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
