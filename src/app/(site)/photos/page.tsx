import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { FolderCard } from "@/components/photos/folder-card";
import { listPhotoSubjects } from "@/lib/photos/photos";

/** Counts change as people upload; never cache a stale zero. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Photos - CU Snowboarding",
  robots: { index: false, follow: false },
};

/**
 * One folder per outing that has started, listed even with zero photos: the
 * empty gallery is the invitation. Outings still ahead have nothing to show,
 * so they wait until their day. `listPhotoSubjects` already sorts newest first.
 */
export default async function PhotosPage() {
  const now = Date.now();
  const galleries = (await listPhotoSubjects()).filter(
    (subject) => subject.startsAt.getTime() <= now,
  );

  return (
    <main className="mx-auto max-w-7xl overflow-x-clip px-5 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Photos</h1>
      </header>

      {galleries.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No galleries yet - each trip and event gets one here once it has started.
          </p>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {galleries.map((subject) => (
            <li key={`${subject.type}-${subject.id}`}>
              <FolderCard subject={subject} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
