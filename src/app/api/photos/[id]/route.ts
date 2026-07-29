import { NextResponse, type NextRequest } from "next/server";
import { removePhoto } from "@/lib/photos";
import { resolvePhotoViewer } from "../_viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await resolvePhotoViewer();
  if (!viewer.memberId && !viewer.isModerator) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;
  // A DELETE body is awkward for fetch and for proxies, so the board's reason
  // rides in the query string instead.
  const reason = request.nextUrl.searchParams.get("reason")?.slice(0, 500) || null;

  const result = await removePhoto(id, viewer, reason);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "not_found" ? 404 : 403 },
    );
  }

  return NextResponse.json({ ok: true });
}
