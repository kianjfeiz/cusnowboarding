import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { finalizePhoto } from "@/lib/photos/photos";
import { generateThumbnails } from "@/lib/photos/thumbnails";
import { resolvePhotoViewer } from "@/lib/photos/viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Room for the thumbnail work scheduled with after() to finish on a trip's first view. */
export const maxDuration = 60;

const bodySchema = z.object({
  width: z.number().int().positive().max(100_000).optional().nullable(),
  height: z.number().int().positive().max(100_000).optional().nullable(),
});

const REASON_STATUS: Record<string, number> = {
  not_found: 404,
  missing_object: 409,
  too_large: 413,
};

/**
 * The browser tells us its direct upload landed. Nothing is trusted from that
 * claim except the timing - `finalizePhoto` goes and looks in the bucket.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await resolvePhotoViewer();
  if (!viewer.memberId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const parsed = bodySchema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await finalizePhoto(id, viewer.memberId, {
    width: parsed.data.width ?? null,
    height: parsed.data.height ?? null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: REASON_STATUS[result.reason] ?? 400 },
    );
  }

  // After the response, so the uploader moves on to the next file meanwhile.
  after(() => generateThumbnails([id]));
  return NextResponse.json({ ok: true });
}
