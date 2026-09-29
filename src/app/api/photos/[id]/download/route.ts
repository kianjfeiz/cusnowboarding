import { NextResponse } from "next/server";
import { getPhotoDownload } from "@/lib/photos/photos";
import { resolvePhotoViewer } from "@/lib/photos/viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Redirects to a short-lived signed URL that saves the photo to disk, so the
 * bytes go straight from R2 to the browser rather than through a function.
 * `no-store` because a cached 302 would hand back a dead signature later, or a
 * live one to someone whose access was since removed.
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

  // One status for "no such photo" and "not yours", so ids cannot be walked.
  if (!download) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.redirect(download.url, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
