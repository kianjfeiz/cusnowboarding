import { NextResponse } from "next/server";
import { getPhotoDownload } from "@/lib/photos";
import { resolvePhotoViewer } from "../../_viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Redirects to a short-lived signed URL that saves the photo to disk.
 *
 * A redirect rather than a proxy: the bytes go straight from R2 to the browser,
 * so a member pulling forty trip photos does not stream a few hundred megabytes
 * through a serverless function that is billed by the second and capped well
 * below that. It is the same reason uploads PUT directly to the bucket.
 *
 * `no-store` because the redirect target carries a signature with fifteen
 * minutes on it. Letting a browser or a CDN keep the 302 would hand back a dead
 * URL later, and worse, would let it be replayed by someone who should not have
 * it after their access was removed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await resolvePhotoViewer();
  if (!viewer.memberId && !viewer.isModerator) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;
  const download = await getPhotoDownload(id, viewer);

  /*
    One status for "no such photo" and for "not yours" on purpose. Telling the
    two apart would let anyone with a member session walk photo ids and learn
    which ones exist, which is a slow inventory of other trips' galleries.
  */
  if (!download) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.redirect(download.url, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
