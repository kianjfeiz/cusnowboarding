import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { claimSpot, generatePayToken } from "@/lib/claims/claim";
import { pool } from "@/lib/db";
import {
  ANONYMOUS_VIEWER,
  PhotoAccessError,
  canUsePhotos,
  createPendingPhoto,
  finalizePhoto,
  PREVIEW_COUNT,
  getGalleryTripBySlug,
  listGalleryTrips,
  listPhotos,
  removePhoto,
  type PhotoViewer,
} from "@/lib/photos/photos";
import { createTestTrip, deleteTestTrips, getMemberIds, setupPool } from "./helpers";

/**
 * The photo rules, tested against the real database.
 *
 * The pool is club-wide by explicit board decision: any signed-in member may
 * view and upload to any trip gallery. What is left worth proving is the
 * boundary that remains - signed out means nothing, events and draft or
 * archived trips have no gallery, and removal stays with the uploader and the
 * board.
 * Everything here talks to `lib/photos/photos.ts` directly: HTTP and R2 are
 * transport, and a rule that only holds when reached through a route is not a
 * rule.
 */

let memberA: string;
let memberB: string;
let memberC: string;
let boardUserId: string;
let tripId: string;

const BOARD_EMAIL = `photo-test-board-${process.pid}@example.test`;
const EVENT_SLUG_PREFIX = `test-event-${process.pid}`;

const asMember = (memberId: string): PhotoViewer => ({
  memberId,
  boardUserId: null,
  isModerator: false,
});

const asBoard = (memberId: string | null = null): PhotoViewer => ({
  memberId,
  boardUserId,
  isModerator: true,
});

async function createTestEvent() {
  const slug = `${EVENT_SLUG_PREFIX}-${randomUUID().slice(0, 8)}`;
  const { rows } = await setupPool.query<{ id: string }>(
    `insert into events (slug, title, kind, starts_at, status)
     values ($1, $2, 'social', now() - interval '2 days', 'published')
     returning id`,
    [slug, `Test event ${slug}`],
  );
  return { id: rows[0].id, slug };
}

async function insertPhoto(
  tripId: string,
  uploaderMemberId: string,
  status: "processing" | "ready" | "removed" = "ready",
): Promise<string> {
  const { rows } = await setupPool.query<{ id: string }>(
    `insert into trip_photos
       (trip_id, uploader_member_id, storage_key, content_type, size_bytes, status)
     values ($1, $2, $3, 'image/jpeg', 204800, $4::photo_status)
     returning id`,
    [tripId, uploaderMemberId, `trips/${tripId}/${randomUUID()}.jpg`, status],
  );
  return rows[0].id;
}

async function getPhotoRow(photoId: string) {
  const { rows } = await setupPool.query<{
    status: string;
    removed_by_board_user_id: string | null;
    removed_reason: string | null;
  }>(
    `select status::text as status, removed_by_board_user_id, removed_reason
       from trip_photos where id = $1`,
    [photoId],
  );
  return rows[0] ?? null;
}

beforeAll(async () => {
  // The suite must not depend on anyone's R2 credentials, and forcing the
  // unconfigured path also proves the graceful degradation is real.
  vi.stubEnv("R2_ACCOUNT_ID", "");
  vi.stubEnv("R2_ACCESS_KEY_ID", "");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
  vi.stubEnv("R2_BUCKET", "");

  [memberA, memberB, memberC] = await getMemberIds(3);

  const { rows } = await setupPool.query<{ id: string }>(
    `insert into board_users (email, name, is_active)
     values ($1, 'Photo Test Board', true)
     on conflict (email) do update set is_active = true
     returning id`,
    [BOARD_EMAIL],
  );
  boardUserId = rows[0].id;

  tripId = await createTestTrip({ capacity: 2 });
  // One person actually on the trip, to prove attendance no longer matters.
  await claimSpot(pool, tripId, memberA, generatePayToken());
});

afterAll(async () => {
  await deleteTestTrips();
  await setupPool.query(`delete from events where slug like $1`, [`${EVENT_SLUG_PREFIX}%`]);
  await setupPool.query(`delete from board_users where email = $1`, [BOARD_EMAIL]);
  vi.unstubAllEnvs();
  await setupPool.end();
  await pool.end();
});

describe("who may use the photo pool", () => {
  test("any signed-in member, on the trip or not", () => {
    expect(canUsePhotos(asMember(memberA))).toBe(true);
    expect(canUsePhotos(asMember(memberC))).toBe(true);
    expect(canUsePhotos(asBoard())).toBe(true);
  });

  test("nobody signed out", () => {
    expect(canUsePhotos(ANONYMOUS_VIEWER)).toBe(false);
  });

  test("listing refuses the signed-out rather than returning an empty gallery", async () => {
    await insertPhoto(tripId, memberA);

    await expect(listPhotos(tripId, ANONYMOUS_VIEWER)).rejects.toBeInstanceOf(
      PhotoAccessError,
    );
  });
});

describe("listing galleries", () => {
  test("a member who was never on the trip sees its photos", async () => {
    const mine = await insertPhoto(tripId, memberA);

    const photos = await listPhotos(tripId, asMember(memberC));
    expect(photos.some((p) => p.id === mine)).toBe(true);
  });

  test("shows only ready photos, with uploader attribution", async () => {
    const fresh = await createTestTrip({ capacity: 2 });

    const ready = await insertPhoto(fresh, memberA, "ready");
    await insertPhoto(fresh, memberA, "processing");
    await insertPhoto(fresh, memberA, "removed");

    const photos = await listPhotos(fresh, asMember(memberB));
    expect(photos.map((p) => p.id)).toEqual([ready]);
    expect(photos[0].uploaderMemberId).toBe(memberA);
    expect(photos[0].uploaderName.length).toBeGreaterThan(0);
    // Storage is deliberately unconfigured here; the row still lists.
    expect(photos[0].url).toBeNull();
  });

  test("a trip gallery never shows another trip's photos", async () => {
    const otherTrip = await createTestTrip({ capacity: 2 });
    const onOther = await insertPhoto(otherTrip, memberA);

    const photos = await listPhotos(tripId, asMember(memberA));
    expect(photos.some((p) => p.id === onOther)).toBe(false);
  });

  test("canRemove is set for the uploader and the board, and for nobody else", async () => {
    const photoId = await insertPhoto(tripId, memberA);

    const own = await listPhotos(tripId, asMember(memberA));
    expect(own.find((p) => p.id === photoId)?.canRemove).toBe(true);

    const other = await listPhotos(tripId, asMember(memberB));
    expect(other.find((p) => p.id === photoId)?.canRemove).toBe(false);

    const board = await listPhotos(tripId, asBoard());
    expect(board.find((p) => p.id === photoId)?.canRemove).toBe(true);
  });
});

describe("the Photos tab listing", () => {
  test("lists trips with ready counts", async () => {
    const cards = await listGalleryTrips(asMember(memberC));

    const card = cards.find((c) => c.id === tripId);
    expect(card).toBeDefined();
    expect(card!.photoCount).toBeGreaterThan(0);
  });

  test("previews the gallery's first ready photos, in gallery order", async () => {
    const fresh = await createTestTrip({ capacity: 2 });
    for (let i = 0; i < PREVIEW_COUNT + 2; i++) await insertPhoto(fresh, memberA);
    await insertPhoto(fresh, memberA, "removed");

    const card = (await listGalleryTrips(asMember(memberB))).find((c) => c.id === fresh);
    const gallery = await listPhotos(fresh, asMember(memberB));

    expect(card!.photoCount).toBe(PREVIEW_COUNT + 2);
    expect(card!.preview.map((p) => p.id)).toEqual(
      gallery.slice(0, PREVIEW_COUNT).map((p) => p.id),
    );
  });

  test("an empty gallery is listed with an empty preview", async () => {
    const empty = await createTestTrip({ capacity: 2 });
    const card = (await listGalleryTrips(asMember(memberB))).find((c) => c.id === empty);
    expect(card?.photoCount).toBe(0);
    expect(card?.preview).toEqual([]);
  });

  test("refuses the signed-out rather than handing them signed URLs", async () => {
    await expect(listGalleryTrips(ANONYMOUS_VIEWER)).rejects.toBeInstanceOf(PhotoAccessError);
  });

  test("events get no gallery", async () => {
    const event = await createTestEvent();
    const cards = await listGalleryTrips(asMember(memberA));
    expect(cards.some((c) => c.id === event.id)).toBe(false);
    expect(await getGalleryTripBySlug(event.slug)).toBeNull();
  });

  test("slug lookup finds a trip", async () => {
    const { rows } = await setupPool.query<{ slug: string }>(
      `select slug from trips where id = $1`,
      [tripId],
    );
    expect((await getGalleryTripBySlug(rows[0].slug))?.id).toBe(tripId);
  });
});

describe("uploading", () => {
  test("any member may start an upload; only the missing bucket stops it here", async () => {
    // memberC was never on this trip - attendance no longer gates uploads.
    const result = await createPendingPhoto({
      tripId,
      memberId: memberC,
      contentType: "image/jpeg",
      sizeBytes: 1_000_000,
    });

    expect(result).toEqual({ ok: false, reason: "storage_unconfigured" });
  });

  test("an event id is refused before any storage work", async () => {
    const event = await createTestEvent();
    const result = await createPendingPhoto({
      tripId: event.id,
      memberId: memberA,
      contentType: "image/jpeg",
      sizeBytes: 1_000_000,
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  test("rejects unsupported types and oversized files", async () => {
    expect(
      await createPendingPhoto({
        tripId,
        memberId: memberA,
        contentType: "video/mp4",
        sizeBytes: 1000,
      }),
    ).toEqual({ ok: false, reason: "unsupported_type" });

    expect(
      await createPendingPhoto({
        tripId,
        memberId: memberA,
        contentType: "image/jpeg",
        sizeBytes: 40 * 1024 * 1024,
      }),
    ).toEqual({ ok: false, reason: "too_large" });
  });

  test("only the uploader may finalize their own pending row", async () => {
    const photoId = await insertPhoto(tripId, memberA, "processing");

    expect(await finalizePhoto(photoId, memberB)).toEqual({ ok: false, reason: "not_found" });
    expect((await getPhotoRow(photoId))?.status).toBe("processing");

    expect(await finalizePhoto(photoId, memberA, { width: 4032, height: 3024 })).toEqual({
      ok: true,
    });
    expect((await getPhotoRow(photoId))?.status).toBe("ready");
  });
});

describe("removal", () => {
  test("the uploader may remove their own", async () => {
    const photoId = await insertPhoto(tripId, memberA);

    expect(await removePhoto(photoId, asMember(memberA))).toEqual({ ok: true });

    const row = await getPhotoRow(photoId);
    // Hidden, never deleted: a removal has to stay reviewable.
    expect(row?.status).toBe("removed");
    expect(row?.removed_by_board_user_id).toBeNull();

    const photos = await listPhotos(tripId, asMember(memberA));
    expect(photos.some((p) => p.id === photoId)).toBe(false);
  });

  test("a non-board member cannot remove someone else's", async () => {
    const photoId = await insertPhoto(tripId, memberA);

    expect(await removePhoto(photoId, asMember(memberB))).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect((await getPhotoRow(photoId))?.status).toBe("ready");
  });

  test("an unauthenticated caller cannot remove anything", async () => {
    const photoId = await insertPhoto(tripId, memberA);

    expect(await removePhoto(photoId, ANONYMOUS_VIEWER)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect((await getPhotoRow(photoId))?.status).toBe("ready");
  });

  test("the board may remove any, and the removal is attributed", async () => {
    const photoId = await insertPhoto(tripId, memberA);

    expect(await removePhoto(photoId, asBoard(), "Rider asked for it to come down")).toEqual({
      ok: true,
    });

    const row = await getPhotoRow(photoId);
    expect(row?.status).toBe("removed");
    expect(row?.removed_by_board_user_id).toBe(boardUserId);
    expect(row?.removed_reason).toBe("Rider asked for it to come down");
  });

  test("a board member removing their own photo is not recorded as moderation", async () => {
    const photoId = await insertPhoto(tripId, memberA);

    expect(await removePhoto(photoId, asBoard(memberA))).toEqual({ ok: true });
    expect((await getPhotoRow(photoId))?.removed_by_board_user_id).toBeNull();
  });

  test("removing an unknown photo reports not_found", async () => {
    expect(await removePhoto(randomUUID(), asBoard())).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
