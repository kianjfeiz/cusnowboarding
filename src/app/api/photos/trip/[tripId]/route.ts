import { NextResponse } from "next/server";
import { PhotoAccessError, listTripPhotos } from "@/lib/photos";
import { isPhotoStorageConfigured } from "@/lib/storage/r2";
import { resolvePhotoViewer } from "../../_viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { tripId } = await params;
  const viewer = await resolvePhotoViewer();

  try {
    const photos = await listTripPhotos(tripId, viewer);
    return NextResponse.json(
      { storageConfigured: isPhotoStorageConfigured(), photos },
      // The URLs inside expire; a cached copy of this response would hand out
      // dead links, and a shared cache would hand them to the wrong people.
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof PhotoAccessError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw error;
  }
}
