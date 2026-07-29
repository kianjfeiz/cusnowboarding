import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  ALLOWED_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  createPendingPhoto,
} from "@/lib/photos";
import { rateLimit } from "@/lib/rate-limit";
import { resolvePhotoViewer } from "../_viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  tripId: z.uuid(),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  originalFilename: z.string().trim().max(255).optional().nullable(),
  takenAt: z.iso.datetime().optional().nullable(),
});

const REASON_STATUS: Record<string, number> = {
  forbidden: 403,
  unsupported_type: 415,
  too_large: 413,
  empty: 400,
  storage_unconfigured: 503,
};

export async function POST(request: NextRequest) {
  const viewer = await resolvePhotoViewer();
  if (!viewer.memberId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  /**
   * A trip weekend genuinely produces a hundred photos from one person, so the
   * limit is set where a normal dump fits and a script does not. It is keyed to
   * the member rather than the IP because the whole club shares a bus and a
   * lodge wifi.
   */
  const limit = await rateLimit("photo-upload", viewer.memberId, 100, 60 * 60);
  if (!limit.success) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const result = await createPendingPhoto({
    tripId: parsed.data.tripId,
    memberId: viewer.memberId,
    contentType: parsed.data.contentType,
    sizeBytes: parsed.data.sizeBytes,
    originalFilename: parsed.data.originalFilename ?? null,
    takenAt: parsed.data.takenAt ? new Date(parsed.data.takenAt) : null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: REASON_STATUS[result.reason] ?? 400 },
    );
  }

  return NextResponse.json({
    photoId: result.photoId,
    uploadUrl: result.uploadUrl,
    storageKey: result.storageKey,
  });
}
