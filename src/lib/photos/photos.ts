import { randomUUID } from "node:crypto";
import { execute } from "@/lib/db";
import {
  deleteObject,
  headObject,
  isPhotoStorageConfigured,
  presignDownload,
  presignRead,
  presignUpload,
} from "@/lib/photos/r2";

/**
 * The club photo pool, one gallery per trip. Events do not get galleries.
 *
 * ONE RULE GOVERNS THIS FILE: any signed-in member may view and upload to any
 * gallery, by the board's explicit decision; removal stays with the uploader or
 * the board. The rule is enforced here in the domain layer so a route cannot
 * forget it. The storage key is never treated as a secret, which is why bytes
 * live in a private bucket behind short-lived signed URLs.
 */

export const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

type PhotoContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

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
 * `isModerator` is a board member holding viewRosters, who may remove anything.
 * It is independent of `memberId`: someone can be both at once.
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

/** The whole rule: signed in, or on the board. No per-outing gate. */
export function canUsePhotos(viewer: PhotoViewer): boolean {
  return viewer.memberId !== null || viewer.isModerator;
}

/**
 * The single definition of which galleries exist: every trip members are shown
 * at all. Drafts have not been announced and archived trips are out of the
 * running. Events never get one - the `event_id` column on `trip_photos` is
 * left over from when they did. This is existence, not access - access is
 * `canUsePhotos`.
 */
const GALLERY_TRIPS = `(
  select id, slug, title, resort as place, depart_at as "startsAt"
    from trips
   where status <> 'draft' and archived_at is null
)`;

/**
 * taken_at first so a weekend reads as the day it was; photos whose EXIF did
 * not survive the upload fall to the end in arrival order. Shared so the Photos
 * tab preview shows the same first photos the gallery opens on.
 */
const GALLERY_ORDER = "p.taken_at, p.created_at";

export interface GalleryPhoto {
  id: string;
  /** Freshly signed, short lived, and null when storage is not configured. */
  url: string | null;
  caption: string | null;
  takenAt: Date | null;
  createdAt: Date;
  uploaderMemberId: string;
  uploaderName: string;
  /** Precomputed so the UI never has to re-derive the rule and get it wrong. */
  canRemove: boolean;
}

/**
 * Every ready photo in this gallery, each with its own fresh signature.
 * Throws rather than returning an empty list when the viewer is signed out:
 * an empty gallery and a forbidden one must not look alike to a caller that
 * forgot to check.
 */
export async function listPhotos(
  tripId: string,
  viewer: PhotoViewer,
): Promise<GalleryPhoto[]> {
  if (!canUsePhotos(viewer)) throw new PhotoAccessError();

  const rows = await execute<Omit<GalleryPhoto, "url" | "canRemove"> & { storageKey: string }>(
    `select p.id, p.storage_key as "storageKey", p.caption, p.taken_at as "takenAt",
            p.created_at as "createdAt", p.uploader_member_id as "uploaderMemberId",
            m.first_name || ' ' || m.last_name as "uploaderName"
       from trip_photos p
       join members m on m.id = p.uploader_member_id
      where p.trip_id = $1 and p.status = 'ready'
      order by ${GALLERY_ORDER}`,
    [tripId],
  );

  return Promise.all(
    rows.map(async ({ storageKey, ...photo }) => ({
      ...photo,
      url: await presignRead(storageKey),
      canRemove: viewer.isModerator || viewer.memberId === photo.uploaderMemberId,
    })),
  );
}

/**
 * A URL that saves one photo to disk, or null if there is no such photo. Signed
 * per request rather than per gallery tile, so a download URL never sits in the
 * DOM from page load.
 */
export async function getPhotoDownload(
  photoId: string,
  viewer: PhotoViewer,
): Promise<{ url: string; filename: string } | null> {
  if (!canUsePhotos(viewer)) return null;

  const rows = await execute<{
    storage_key: string;
    content_type: string;
    original_filename: string | null;
  }>(
    `select storage_key, content_type, original_filename
       from trip_photos
      where id = $1 and status = 'ready'`,
    [photoId],
  );

  const photo = rows[0];
  if (!photo) return null;

  // The uploader's own filename is the one that means something to them; the
  // id is the fallback because it is guaranteed unique.
  const extension = isAllowedContentType(photo.content_type)
    ? EXTENSIONS[photo.content_type]
    : "jpg";
  const filename = photo.original_filename?.trim() || `${photoId}.${extension}`;

  const url = await presignDownload(photo.storage_key, filename);
  return url ? { url, filename } : null;
}

export interface GalleryTrip {
  id: string;
  slug: string;
  title: string;
  /** The resort; null when unset. */
  place: string | null;
  startsAt: Date;
}

/** How many photos a Photos tab tile previews. */
export const PREVIEW_COUNT = 4;

export interface GalleryTripCard extends GalleryTrip {
  photoCount: number;
  /** The gallery's first few photos, freshly signed; null urls when storage is unset. */
  preview: { id: string; url: string | null }[];
}

/**
 * Every trip gallery, newest first, with its ready-photo count and the first
 * few photos. Zero-photo trips are listed on purpose: the empty gallery is the
 * invitation to fill it after the weekend. Like `listPhotos`, this refuses the
 * signed-out rather than handing them signed URLs.
 */
export async function listGalleryTrips(viewer: PhotoViewer): Promise<GalleryTripCard[]> {
  if (!canUsePhotos(viewer)) throw new PhotoAccessError();

  const rows = await execute<
    GalleryTrip & { photoCount: number; previewKeys: { id: string; key: string }[] }
  >(
    `select t.*,
            (select count(*)::int from trip_photos p
              where p.trip_id = t.id and p.status = 'ready') as "photoCount",
            coalesce((select json_agg(json_build_object('id', f.id, 'key', f.storage_key))
                        from (select p.id, p.storage_key from trip_photos p
                               where p.trip_id = t.id and p.status = 'ready'
                               order by ${GALLERY_ORDER}
                               limit ${PREVIEW_COUNT}) f), '[]'::json) as "previewKeys"
       from ${GALLERY_TRIPS} t
      order by t."startsAt" desc`,
  );

  return Promise.all(
    rows.map(async ({ previewKeys, ...trip }) => ({
      ...trip,
      preview: await Promise.all(
        previewKeys.map(async ({ id, key }) => ({ id, url: await presignRead(key) })),
      ),
    })),
  );
}

/** The gallery page's lookup: same visibility rules as the listing above. */
export async function getGalleryTripBySlug(slug: string): Promise<GalleryTrip | null> {
  const rows = await execute<GalleryTrip>(
    `select t.* from ${GALLERY_TRIPS} t where t.slug = $1 limit 1`,
    [slug],
  );
  return rows[0] ?? null;
}

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
 * Reserves a row and hands back a URL the browser can PUT to. The row is
 * written before the bytes exist, in `processing` (visible to nobody), so an
 * abandoned upload leaves a trace rather than an orphaned object.
 */
export async function createPendingPhoto(
  input: CreatePendingPhotoInput,
): Promise<CreatePendingPhotoResult> {
  if (!isAllowedContentType(input.contentType)) return { ok: false, reason: "unsupported_type" };
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, reason: "empty" };
  }
  if (input.sizeBytes > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };

  // Any member may upload; what must exist is the gallery itself. A draft or
  // archived trip gets "forbidden" rather than a distinct answer, so ids
  // cannot be walked to learn which drafts exist.
  const visible = await execute(`select 1 from ${GALLERY_TRIPS} t where t.id = $1`, [
    input.tripId,
  ]);
  if (visible.length === 0) return { ok: false, reason: "forbidden" };

  if (!isPhotoStorageConfigured()) return { ok: false, reason: "storage_unconfigured" };

  // Namespaced by trip so a bucket listing, a lifecycle rule, or a bulk
  // delete can operate on one gallery without consulting the database.
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

/**
 * Flips a pending row to `ready` once the browser reports its PUT succeeded.
 * Scoped to the uploader and to `processing`, so it cannot revive a removed
 * photo or publish someone else's.
 *
 * The size is re-read from the bucket rather than trusted: the presigned URL
 * commits the client to a content type but not to a length.
 */
export async function finalizePhoto(
  photoId: string,
  memberId: string,
  dimensions: { width?: number | null; height?: number | null } = {},
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "missing_object" | "too_large" }> {
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

/**
 * Hides a photo. Never deletes the row or the bytes, so a removal can be
 * reviewed or undone. The exception is a row still in `processing`: it was
 * never visible to anyone, so its object is genuinely orphaned.
 */
export async function removePhoto(
  photoId: string,
  actor: PhotoViewer,
  reason?: string | null,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "forbidden" }> {
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
