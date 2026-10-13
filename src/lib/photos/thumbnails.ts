import { execute } from "@/lib/db";
import { getObjectBytes, isPhotoStorageConfigured, putObject } from "@/lib/photos/r2";

/**
 * Small display copies of gallery photos, made on the server. Grids and the
 * Photos tab show these; only the lightbox and downloads touch the original,
 * which is often 3-8MB straight off a phone.
 */

/** Longest edge. A grid square is ~240 CSS px, so this stays sharp at 2x. */
const THUMBNAIL_MAX_EDGE = 640;

/** What the bundled sharp can decode. HEIC needs a codec it does not ship. */
const DECODABLE = ["image/jpeg", "image/png", "image/webp"];

/** Bounds the work one page view can schedule, so a backlog drains gradually. */
const MAX_PER_RUN = 4;

export function thumbnailKeyFor(storageKey: string): string {
  return `${storageKey.replace(/\.[a-z0-9]+$/i, "")}.thumb.webp`;
}

export async function makeThumbnail(original: Uint8Array): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return (
    sharp(original)
      // Phones store orientation as an EXIF flag the browser honours on the
      // original; resizing drops the flag, so bake the rotation into pixels.
      .rotate()
      .resize({
        width: THUMBNAIL_MAX_EDGE,
        height: THUMBNAIL_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 72 })
      .toBuffer()
  );
}

/**
 * Makes thumbnails for whichever of these photos still lack one, a few at a
 * time. Safe to run concurrently or repeatedly: the key is derived from the
 * original, so a duplicate run overwrites identical bytes, and the row is only
 * claimed while still empty. Never throws - it runs after the response, where
 * nobody is waiting on it.
 */
export async function generateThumbnails(photoIds: string[]): Promise<number> {
  if (photoIds.length === 0 || !isPhotoStorageConfigured()) return 0;

  const rows = await execute<{ id: string; storage_key: string }>(
    `select id, storage_key from trip_photos
      where id = any($1::uuid[]) and status = 'ready' and thumbnail_key is null
        and content_type = any($2::text[])
      limit ${MAX_PER_RUN}`,
    [photoIds, DECODABLE],
  ).catch(() => []);

  let made = 0;
  // One at a time: each original is decoded in full, and serverless memory is finite.
  for (const row of rows) {
    try {
      const original = await getObjectBytes(row.storage_key);
      if (!original) continue;

      const key = thumbnailKeyFor(row.storage_key);
      if (!(await putObject(key, await makeThumbnail(original), "image/webp"))) continue;

      await execute(
        `update trip_photos set thumbnail_key = $2, updated_at = now()
          where id = $1 and thumbnail_key is null`,
        [row.id, key],
      );
      made++;
    } catch (error) {
      console.error("thumbnail failed", row.id, error);
    }
  }
  return made;
}
