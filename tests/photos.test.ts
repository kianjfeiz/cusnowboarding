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
  getPhotoSubjectBySlug,
  listPhotoSubjects,
  listPhotos,
  removePhoto,
  type PhotoSubject,
  type PhotoViewer,
} from "@/lib/photos/photos";
import { createTestTrip, deleteTestTrips, getMemberIds, setupPool } from "./helpers";

/**
 * The photo rules, tested against the real database.
 *
 * The pool is club-wide by explicit board decision: any signed-in member may
 * view and upload to any trip or event gallery. What is left worth proving is
 * the boundary that remains - signed out means nothing, drafts and archived
 * outings have no gallery, and removal stays with the uploader and the board.
 * Everything here talks to `lib/photos/photos.ts` directly: HTTP and R2 are
 * transport, and a rule that only holds when reached through a route is not a
 * rule.
 */

let memberA: string;
let memberB: string;
let memberC: string;
let boardUserId: string;
let tripId: string;
let eventId: string;
let eventSlug: string;

const BOARD_EMAIL = `photo-test-board-${process.pid}@example.test`;
const EVENT_SLUG_PREFIX = `test-event-${process.pid}`;

const trip = (id: string): PhotoSubject => ({ type: "trip", id });
const event = (id: string): PhotoSubject => ({ type: "event", id });

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

async function createTestEvent(status: "published" | "draft" = "published") {
  const slug = `${EVENT_SLUG_PREFIX}-${randomUUID().slice(0, 8)}`;
  const { rows } = await setupPool.query<{ id: string }>(
    `insert into events (slug, title, kind, starts_at, status)
     values ($1, $2, 'social', now() - interval '2 days', $3::event_status)
     returning id`,
    [slug, `Test event ${slug}`, status],
  );
  return { id: rows[0].id, slug };
}

async function insertPhoto(
  subject: PhotoSubject,
  uploaderMemberId: string,
  status: "processing" | "ready" | "removed" = "ready",
): Promise<string> {
  const column = subject.type === "trip" ? "trip_id" : "event_id";
  const { rows } = await setupPool.query<{ id: string }>(
    `insert into trip_photos
       (${column}, uploader_member_id, storage_key, content_type, size_bytes, status)
     values ($1, $2, $3, 'image/jpeg', 204800, $4::photo_status)
     returning id`,
    [
      subject.id,
      uploaderMemberId,
      `${subject.type}s/${subject.id}/${randomUUID()}.jpg`,
      status,
    ],
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

  const created = await createTestEvent();
  eventId = created.id;
  eventSlug = created.slug;
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
    await insertPhoto(trip(tripId), memberA);

    await expect(listPhotos(trip(tripId), ANONYMOUS_VIEWER)).rejects.toBeInstanceOf(
      PhotoAccessError,
    );
  });
});

describe("listing galleries", () => {
  test("a member who was never on the trip sees its photos", async () => {
    const mine = await insertPhoto(trip(tripId), memberA);

    const photos = await listPhotos(trip(tripId), asMember(memberC));
    expect(photos.some((p) => p.id === mine)).toBe(true);
  });

  test("shows only ready photos, with uploader attribution", async () => {
    const fresh = await createTestTrip({ capacity: 2 });

    const ready = await insertPhoto(trip(fresh), memberA, "ready");
    await insertPhoto(trip(fresh), memberA, "processing");
    await insertPhoto(trip(fresh), memberA, "removed");

    const photos = await listPhotos(trip(fresh), asMember(memberB));
    expect(photos.map((p) => p.id)).toEqual([ready]);
    expect(photos[0].uploaderMemberId).toBe(memberA);
    expect(photos[0].uploaderName.length).toBeGreaterThan(0);
    // Storage is deliberately unconfigured here; the row still lists.
    expect(photos[0].url).toBeNull();
  });

  test("an event gallery works the same way", async () => {
    const photoId = await insertPhoto(event(eventId), memberB);

    const photos = await listPhotos(event(eventId), asMember(memberC));
    expect(photos.some((p) => p.id === photoId)).toBe(true);
  });

  test("a trip gallery never shows an event's photos, or another trip's", async () => {
    const otherTrip = await createTestTrip({ capacity: 2 });
    const onEvent = await insertPhoto(event(eventId), memberA);
    const onOther = await insertPhoto(trip(otherTrip), memberA);

    const photos = await listPhotos(trip(tripId), asMember(memberA));
    expect(photos.some((p) => p.id === onEvent)).toBe(false);
    expect(photos.some((p) => p.id === onOther)).toBe(false);
  });

  test("canRemove is set for the uploader and the board, and for nobody else", async () => {
    const photoId = await insertPhoto(trip(tripId), memberA);

    const own = await listPhotos(trip(tripId), asMember(memberA));
    expect(own.find((p) => p.id === photoId)?.canRemove).toBe(true);

    const other = await listPhotos(trip(tripId), asMember(memberB));
    expect(other.find((p) => p.id === photoId)?.canRemove).toBe(false);

    const board = await listPhotos(trip(tripId), asBoard());
    expect(board.find((p) => p.id === photoId)?.canRemove).toBe(true);
  });
});

describe("the Photos tab listing", () => {
  test("lists trips and published events with ready counts", async () => {
    const subjects = await listPhotoSubjects();

    const tripCard = subjects.find((s) => s.type === "trip" && s.id === tripId);
    expect(tripCard).toBeDefined();
    expect(tripCard!.photoCount).toBeGreaterThan(0);

    const eventCard = subjects.find((s) => s.type === "event" && s.id === eventId);
    expect(eventCard).toBeDefined();
  });

  test("draft events are not offered", async () => {
    const draft = await createTestEvent("draft");
    const subjects = await listPhotoSubjects();
    expect(subjects.some((s) => s.type === "event" && s.id === draft.id)).toBe(false);
    expect(await getPhotoSubjectBySlug("event", draft.slug)).toBeNull();
  });

  test("slug lookup finds a published event", async () => {
    const found = await getPhotoSubjectBySlug("event", eventSlug);
    expect(found?.id).toBe(eventId);
    expect(found?.type).toBe("event");
  });
});

describe("uploading", () => {
  test("any member may start an upload; only the missing bucket stops it here", async () => {
    // memberC was never on this trip - attendance no longer gates uploads.
    const result = await createPendingPhoto({
      subject: trip(tripId),
      memberId: memberC,
      contentType: "image/jpeg",
      sizeBytes: 1_000_000,
    });

    expect(result).toEqual({ ok: false, reason: "storage_unconfigured" });
  });

  test("an event upload passes the same gate", async () => {
    const result = await createPendingPhoto({
      subject: event(eventId),
      memberId: memberB,
      contentType: "image/jpeg",
      sizeBytes: 1_000_000,
    });

    expect(result).toEqual({ ok: false, reason: "storage_unconfigured" });
  });

  test("a draft event is refused before any storage work", async () => {
    const draft = await createTestEvent("draft");
    const result = await createPendingPhoto({
      subject: event(draft.id),
      memberId: memberA,
      contentType: "image/jpeg",
      sizeBytes: 1_000_000,
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  test("rejects unsupported types and oversized files", async () => {
    expect(
      await createPendingPhoto({
        subject: trip(tripId),
        memberId: memberA,
        contentType: "video/mp4",
        sizeBytes: 1000,
      }),
    ).toEqual({ ok: false, reason: "unsupported_type" });

    expect(
      await createPendingPhoto({
        subject: trip(tripId),
        memberId: memberA,
        contentType: "image/jpeg",
        sizeBytes: 40 * 1024 * 1024,
      }),
    ).toEqual({ ok: false, reason: "too_large" });
  });

  test("only the uploader may finalize their own pending row", async () => {
    const photoId = await insertPhoto(trip(tripId), memberA, "processing");

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
    const photoId = await insertPhoto(trip(tripId), memberA);

    expect(await removePhoto(photoId, asMember(memberA))).toEqual({ ok: true });

    const row = await getPhotoRow(photoId);
    // Hidden, never deleted: a removal has to stay reviewable.
    expect(row?.status).toBe("removed");
    expect(row?.removed_by_board_user_id).toBeNull();

    const photos = await listPhotos(trip(tripId), asMember(memberA));
    expect(photos.some((p) => p.id === photoId)).toBe(false);
  });

  test("a non-board member cannot remove someone else's", async () => {
    const photoId = await insertPhoto(trip(tripId), memberA);

    expect(await removePhoto(photoId, asMember(memberB))).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect((await getPhotoRow(photoId))?.status).toBe("ready");
  });

  test("an unauthenticated caller cannot remove anything", async () => {
    const photoId = await insertPhoto(trip(tripId), memberA);

    expect(await removePhoto(photoId, ANONYMOUS_VIEWER)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect((await getPhotoRow(photoId))?.status).toBe("ready");
  });

  test("the board may remove any, and the removal is attributed", async () => {
    const photoId = await insertPhoto(event(eventId), memberA);

    expect(await removePhoto(photoId, asBoard(), "Rider asked for it to come down")).toEqual({
      ok: true,
    });

    const row = await getPhotoRow(photoId);
    expect(row?.status).toBe("removed");
    expect(row?.removed_by_board_user_id).toBe(boardUserId);
    expect(row?.removed_reason).toBe("Rider asked for it to come down");
  });

  test("a board member removing their own photo is not recorded as moderation", async () => {
    const photoId = await insertPhoto(trip(tripId), memberA);

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
