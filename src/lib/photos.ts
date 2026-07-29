import { randomUUID } from "node:crypto";
import { isTripAttendee } from "@/lib/attendees";
import { execute } from "@/lib/db";
import {
  deleteObject,
  headObject,
  isPhotoStorageConfigured,
  presignRead,
  presignUpload,
} from "@/lib/storage/r2";

/**
 * The trip photo pool.
 *
 * ONE RULE GOVERNS THIS FILE: a trip's photos are visible only to people who
 * were actually on that trip, plus the board. These are identifiable pictures
 * of students, taken on a club trip, and the club has no standing to show them
 * to the wider membership. Widening the audience later is a one-line change;
 * un-sharing something is not.
 *
 * The rule is enforced here, in the domain layer, rather than in the routes -
 * every read, every signed URL, and every upload passes through one of these
 * functions, so there is no path that can forget. The storage key is never
 * treated as a secret: an unguessable URL is not an access control, it is a
 * delay, and it survives being pasted into a group chat.
 */

export const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export type PhotoContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** A recent phone photo is 3-8MB; 25 lets a burst of RAW-ish JPEGs through without inviting video. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const EXTENSIONS: Record<PhotoContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

function isAllowedContentType(value: string): value is PhotoContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * Who is asking.
 *
 * `memberId` is the person; `isModerator` is a board member holding
 * viewRosters, who may see and remove anything. The two are independent -
 * board members go on trips too, so someone can be both at once.
 */
export interface PhotoViewer {
  memberId: string | null;
  boardUserId: string | null;
  isModerator: boolean;
}

export const ANONYMOUS_VIEWER: PhotoViewer = {
  memberId: null,
  boardUserId: null,
  isModerator: false,
};

export class PhotoAccessError extends Error {
  constructor(message = "Not permitted to view these photos") {
    super(message);
    this.name = "PhotoAccessError";
  }
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * "Was on the trip" means a paid signup. Not held, not waitlisted: a held spot
 * is someone who might yet lose it, and a waitlisted one is someone who stayed
 * home. Neither was in the photos.
 */
export async function canViewTripPhotos(
  memberId: string | null,
  tripId: string,
): Promise<boolean> {
  if (!memberId) return false;
  return isTripAttendee(tripId, memberId);
}

/** The board variant: viewRosters already means "may see who went", which is strictly more. */
export function canViewAnyTripPhotos(viewer: PhotoViewer): boolean {
  return viewer.isModerator;
}

export async function canViewerSeeTripPhotos(
  viewer: PhotoViewer,
  tripId: string,
): Promise<boolean> {
  if (canViewAnyTripPhotos(viewer)) return true;
  return canViewTripPhotos(viewer.memberId, tripId);
}

/** Uploading is for people who were there. A board seat is not a licence to add photos. */
export async function canUploadTripPhotos(
  memberId: string | null,
  tripId: string,
): Promise<boolean> {
  return canViewTripPhotos(memberId, tripId);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface GalleryPhoto {
  id: string;
  /** Freshly signed, short lived, and null when storage is not configured. */
  url: string | null;
  contentType: string;
  originalFilename: string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  takenAt: Date | null;
  createdAt: Date;
  uploaderMemberId: string;
  uploaderName: string;
  /** Precomputed so the UI never has to re-derive the rule and get it wrong. */
  canRemove: boolean;
}

interface PhotoRow {
  id: string;
  storage_key: string;
  content_type: string;
  original_filename: string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  taken_at: Date | null;
  created_at: Date;
  uploader_member_id: string;
  uploader_name: string;
}

/**
 * Every photo the viewer is entitled to for this trip, each with its own fresh
 * signature. Throws rather than returning an empty list when the viewer is not
 * entitled: an empty gallery and a forbidden one must not look alike to a
 * caller that forgot to check.
 */
export async function listTripPhotos(
  tripId: string,
  viewer: PhotoViewer,
): Promise<GalleryPhoto[]> {
  if (!(await canViewerSeeTripPhotos(viewer, tripId))) {
    throw new PhotoAccessError();
  }

  const rows = await execute<PhotoRow>(
    `select p.id, p.storage_key, p.content_type, p.original_filename,
            p.width, p.height, p.caption, p.taken_at, p.created_at,
            p.uploader_member_id,
            m.first_name || ' ' || m.last_name as uploader_name
       from trip_photos p
       join members m on m.id = p.uploader_member_id
      where p.trip_id = $1 and p.status = 'ready'
      -- taken_at first so a trip reads as the day it was, with the photos whose
      -- EXIF did not survive the upload falling to the end in arrival order.
      order by p.taken_at, p.created_at`,
    [tripId],
  );

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      url: await presignRead(row.storage_key),
      contentType: row.content_type,
      originalFilename: row.original_filename,
      width: row.width,
      height: row.height,
      caption: row.caption,
      takenAt: row.taken_at,
      createdAt: row.created_at,
      uploaderMemberId: row.uploader_member_id,
      uploaderName: row.uploader_name,
      canRemove: viewer.isModerator || viewer.memberId === row.uploader_member_id,
    })),
  );
}

export async function countTripPhotos(tripId: string): Promise<number> {
  const rows = await execute<{ n: number }>(
    `select count(*)::int as n from trip_photos where trip_id = $1 and status = 'ready'`,
    [tripId],
  );
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Uploading
// ---------------------------------------------------------------------------

export interface CreatePendingPhotoInput {
  tripId: string;
  memberId: string;
  contentType: string;
  sizeBytes: number;
  originalFilename?: string | null;
  takenAt?: Date | null;
}

export type CreatePendingPhotoResult =
  | { ok: true; photoId: string; storageKey: string; uploadUrl: string }
  | {
      ok: false;
      reason: "forbidden" | "unsupported_type" | "too_large" | "empty" | "storage_unconfigured";
    };

/**
 * Reserves a row and hands back a URL the browser can PUT to.
 *
 * The row is written before the bytes exist, in `processing`, so an abandoned
 * upload leaves a trace we can find rather than an orphaned object nobody knows
 * about. Nothing in `processing` is visible to anyone.
 */
export async function createPendingPhoto(
  input: CreatePendingPhotoInput,
): Promise<CreatePendingPhotoResult> {
  if (!isAllowedContentType(input.contentType)) return { ok: false, reason: "unsupported_type" };
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, reason: "empty" };
  }
  if (input.sizeBytes > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };

  if (!(await canUploadTripPhotos(input.memberId, input.tripId))) {
    return { ok: false, reason: "forbidden" };
  }

  if (!isPhotoStorageConfigured()) return { ok: false, reason: "storage_unconfigured" };

  // Namespaced by trip so a bucket listing, a lifecycle rule, or a bulk delete
  // can operate on one trip without consulting the database.
  const storageKey = `trips/${input.tripId}/${randomUUID()}.${EXTENSIONS[input.contentType]}`;

  const uploadUrl = await presignUpload(storageKey, input.contentType);
  if (!uploadUrl) return { ok: false, reason: "storage_unconfigured" };

  const rows = await execute<{ id: string }>(
    `insert into trip_photos (
       trip_id, uploader_member_id, storage_key, original_filename,
       content_type, size_bytes, taken_at, status
     ) values ($1, $2, $3, $4, $5, $6, $7, 'processing')
     returning id`,
    [
      input.tripId,
      input.memberId,
      storageKey,
      input.originalFilename?.slice(0, 255) ?? null,
      input.contentType,
      input.sizeBytes,
      input.takenAt ?? null,
    ],
  );

  return { ok: true, photoId: rows[0].id, storageKey, uploadUrl };
}

export interface FinalizePhotoInput {
  width?: number | null;
  height?: number | null;
}

export type FinalizePhotoResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "missing_object" | "too_large" };

/**
 * Flips a pending row to `ready` once the browser reports its PUT succeeded.
 *
 * Scoped to the uploader and to `processing`, so this cannot be used to revive
 * a photo the board removed, and cannot be used to publish someone else's.
 *
 * The declared size is re-read from the bucket rather than trusted. The
 * presigned URL commits the client to a content type but not to a length, so
 * this is the point where a member who claimed 2MB and uploaded 300 is caught -
 * and where an upload that silently failed is caught too.
 */
export async function finalizePhoto(
  photoId: string,
  memberId: string,
  dimensions: FinalizePhotoInput = {},
): Promise<FinalizePhotoResult> {
  const pending = await execute<{ storage_key: string }>(
    `select storage_key from trip_photos
      where id = $1 and uploader_member_id = $2 and status = 'processing'`,
    [photoId, memberId],
  );

  const row = pending[0];
  if (!row) return { ok: false, reason: "not_found" };

  let sizeBytes: number | null = null;
  if (isPhotoStorageConfigured()) {
    const stored = await headObject(row.storage_key);
    if (!stored || stored.sizeBytes <= 0) return { ok: false, reason: "missing_object" };
    if (stored.sizeBytes > MAX_UPLOAD_BYTES) {
      await deleteObject(row.storage_key);
      return { ok: false, reason: "too_large" };
    }
    sizeBytes = stored.sizeBytes;
  }

  await execute(
    `update trip_photos
        set status     = 'ready',
            width      = coalesce($3::int, width),
            height     = coalesce($4::int, height),
            size_bytes = coalesce($5::int, size_bytes),
            updated_at = now()
      where id = $1 and uploader_member_id = $2 and status = 'processing'`,
    [
      photoId,
      memberId,
      dimensions.width ?? null,
      dimensions.height ?? null,
      sizeBytes,
    ],
  );

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

export type RemovePhotoResult = { ok: true } | { ok: false; reason: "not_found" | "forbidden" };

/**
 * Hides a photo. Never deletes the row.
 *
 * Removal is the one action here that is hard to reverse from the outside - a
 * member deletes a picture they are in, then wants it back, or the board needs
 * to know what was taken down and by whom. Keeping the row costs nothing and
 * answers both.
 *
 * The bytes are kept for the same reason, with one exception: a row still in
 * `processing` was never visible to anyone, so there is nothing to review and
 * the object is genuinely orphaned.
 */
export async function removePhoto(
  photoId: string,
  actor: PhotoViewer,
  reason?: string | null,
): Promise<RemovePhotoResult> {
  const rows = await execute<{
    uploader_member_id: string;
    status: string;
    storage_key: string;
  }>(
    `select uploader_member_id, status::text as status, storage_key
       from trip_photos where id = $1`,
    [photoId],
  );

  const photo = rows[0];
  if (!photo) return { ok: false, reason: "not_found" };

  const isUploader = actor.memberId !== null && actor.memberId === photo.uploader_member_id;
  if (!isUploader && !actor.isModerator) return { ok: false, reason: "forbidden" };

  if (photo.status === "removed") return { ok: true };

  // Board attribution is recorded only when the board capability is what
  // authorised this, so a board member tidying up their own photos does not
  // read later as a moderation action.
  const asBoard = !isUploader && actor.isModerator;

  await execute(
    `update trip_photos
        set status                   = 'removed',
            removed_by_board_user_id = $2,
            removed_reason           = $3,
            updated_at               = now()
      where id = $1`,
    [photoId, asBoard ? actor.boardUserId : null, asBoard ? (reason ?? null) : null],
  );

  if (photo.status === "processing") await deleteObject(photo.storage_key);

  return { ok: true };
}
