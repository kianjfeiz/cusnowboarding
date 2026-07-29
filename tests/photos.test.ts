import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { claimSpot, generatePayToken } from "@/lib/claims/claim";
import { pool } from "@/lib/db";
import {
  ANONYMOUS_VIEWER,
  PhotoAccessError,
  canViewTripPhotos,
  canViewerSeeTripPhotos,
  createPendingPhoto,
  finalizePhoto,
  listTripPhotos,
  removePhoto,
  type PhotoViewer,
} from "@/lib/photos";
import { createTestTrip, deleteTestTrips, getMemberIds, setupPool } from "./helpers";

/**
 * These are the access rules, tested against the real database.
 *
 * The photos are identifiable pictures of students, so the thing worth proving
 * is not that the gallery renders - it is that the people who were not on the
 * trip cannot reach it, by any of the paths that exist. Everything here talks
 * to `lib/photos.ts` directly: HTTP and R2 are transport, and a rule that only
 * holds when it is reached through a route is not a rule.
 */

let paidA: string;
let paidB: string;
let waitlisted: string;
let stranger: string;
let boardUserId: string;
let tripId: string;
let otherTripId: string;

const BOARD_EMAIL = `photo-test-board-${process.pid}@example.test`;

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

async function insertPhoto(
  trip: string,
  uploaderMemberId: string,
  status: "processing" | "ready" | "removed" = "ready",
): Promise<string> {
  const { rows } = await setupPool.query<{ id: string }>(
    `insert into trip_photos
       (trip_id, uploader_member_id, storage_key, content_type, size_bytes, status)
     values ($1, $2, $3, 'image/jpeg', 204800, $4::photo_status)
     returning id`,
    [trip, uploaderMemberId, `trips/${trip}/${randomUUID()}.jpg`, status],
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

  [paidA, paidB, waitlisted, stranger] = await getMemberIds(4);

  const { rows } = await setupPool.query<{ id: string }>(
    `insert into board_users (email, name, is_active)
     values ($1, 'Photo Test Board', true)
     on conflict (email) do update set is_active = true
     returning id`,
    [BOARD_EMAIL],
  );
  boardUserId = rows[0].id;

  tripId = await createTestTrip({ capacity: 2 });
  otherTripId = await createTestTrip({ capacity: 2 });

  for (const memberId of [paidA, paidB, waitlisted]) {
    await claimSpot(pool, tripId, memberId, generatePayToken());
  }
  await setupPool.query(
    `update signups set status = 'paid', paid_at = now()
      where trip_id = $1 and status = 'held'`,
    [tripId],
  );
});

afterAll(async () => {
  await deleteTestTrips();
  await setupPool.query(`delete from board_users where email = $1`, [BOARD_EMAIL]);
  vi.unstubAllEnvs();
  await setupPool.end();
  await pool.end();
});

describe("who may see a trip's photos", () => {
  test("a member who paid for the trip can", async () => {
    expect(await canViewTripPhotos(paidA, tripId)).toBe(true);
    expect(await canViewerSeeTripPhotos(asMember(paidA), tripId)).toBe(true);
  });

  test("a member who was only waitlisted cannot", async () => {
    expect(await canViewTripPhotos(waitlisted, tripId)).toBe(false);
    expect(await canViewerSeeTripPhotos(asMember(waitlisted), tripId)).toBe(false);
  });

  test("a member with no signup at all cannot", async () => {
    expect(await canViewTripPhotos(stranger, tripId)).toBe(false);
  });

  test("an unauthenticated viewer cannot", async () => {
    expect(await canViewTripPhotos(null, tripId)).toBe(false);
    expect(await canViewerSeeTripPhotos(ANONYMOUS_VIEWER, tripId)).toBe(false);
  });

  test("a released spot is not attendance", async () => {
    const dropped = await createTestTrip({ capacity: 2 });
    await claimSpot(pool, dropped, stranger, generatePayToken());
    await setupPool.query(
      `update signups
          set status = 'cancelled', spot_number = null, released_at = now()
        where trip_id = $1 and member_id = $2`,
      [dropped, stranger],
    );

    expect(await canViewTripPhotos(stranger, dropped)).toBe(false);
  });

  test("a board member with viewRosters can see a trip they were not on", async () => {
    expect(await canViewerSeeTripPhotos(asBoard(), tripId)).toBe(true);
  });

  test("attendance is per trip, not club-wide", async () => {
    expect(await canViewTripPhotos(paidA, otherTripId)).toBe(false);
  });
});

describe("listing", () => {
  test("refuses rather than returning an empty gallery", async () => {
    await insertPhoto(tripId, paidA);

    await expect(listTripPhotos(tripId, asMember(waitlisted))).rejects.toBeInstanceOf(
      PhotoAccessError,
    );
    await expect(listTripPhotos(tripId, ANONYMOUS_VIEWER)).rejects.toBeInstanceOf(
      PhotoAccessError,
    );
  });

  test("shows only ready photos, with uploader attribution", async () => {
    const trip = await createTestTrip({ capacity: 2 });
    await claimSpot(pool, trip, paidA, generatePayToken());
    await setupPool.query(`update signups set status = 'paid' where trip_id = $1`, [trip]);

    const ready = await insertPhoto(trip, paidA, "ready");
    await insertPhoto(trip, paidA, "processing");
    await insertPhoto(trip, paidA, "removed");

    const photos = await listTripPhotos(trip, asMember(paidA));
    expect(photos.map((p) => p.id)).toEqual([ready]);
    expect(photos[0].uploaderMemberId).toBe(paidA);
    expect(photos[0].uploaderName.length).toBeGreaterThan(0);
    // Storage is deliberately unconfigured here; the row still lists.
    expect(photos[0].url).toBeNull();
  });

  test("never leaks another trip's photos", async () => {
    const mine = await insertPhoto(tripId, paidB);
    await insertPhoto(otherTripId, stranger);

    const photos = await listTripPhotos(tripId, asMember(paidB));
    expect(photos.some((p) => p.id === mine)).toBe(true);
    expect(photos.every((p) => p.id !== otherTripId)).toBe(true);
  });

  test("canRemove is set for the uploader and the board, and for nobody else", async () => {
    const photoId = await insertPhoto(tripId, paidA);

    const own = await listTripPhotos(tripId, asMember(paidA));
    expect(own.find((p) => p.id === photoId)?.canRemove).toBe(true);

    const other = await listTripPhotos(tripId, asMember(paidB));
    expect(other.find((p) => p.id === photoId)?.canRemove).toBe(false);

    const board = await listTripPhotos(tripId, asBoard());
    expect(board.find((p) => p.id === photoId)?.canRemove).toBe(true);
  });
});

describe("uploading", () => {
  test("a member who was not on the trip is refused before any storage work", async () => {
    const result = await createPendingPhoto({
      tripId,
      memberId: waitlisted,
      contentType: "image/jpeg",
      sizeBytes: 1_000_000,
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  test("attendance is checked before the bucket is", async () => {
    const result = await createPendingPhoto({
      tripId,
      memberId: paidA,
      contentType: "image/jpeg",
      sizeBytes: 1_000_000,
    });

    // Refused for want of a bucket, not for want of permission.
    expect(result).toEqual({ ok: false, reason: "storage_unconfigured" });
  });

  test("rejects unsupported types and oversized files", async () => {
    expect(
      await createPendingPhoto({
        tripId,
        memberId: paidA,
        contentType: "video/mp4",
        sizeBytes: 1000,
      }),
    ).toEqual({ ok: false, reason: "unsupported_type" });

    expect(
      await createPendingPhoto({
        tripId,
        memberId: paidA,
        contentType: "image/jpeg",
        sizeBytes: 40 * 1024 * 1024,
      }),
    ).toEqual({ ok: false, reason: "too_large" });
  });

  test("only the uploader may finalize their own pending row", async () => {
    const photoId = await insertPhoto(tripId, paidA, "processing");

    expect(await finalizePhoto(photoId, paidB)).toEqual({ ok: false, reason: "not_found" });
    expect((await getPhotoRow(photoId))?.status).toBe("processing");

    expect(await finalizePhoto(photoId, paidA, { width: 4032, height: 3024 })).toEqual({
      ok: true,
    });
    expect((await getPhotoRow(photoId))?.status).toBe("ready");
  });
});

describe("removal", () => {
  test("the uploader may remove their own", async () => {
    const photoId = await insertPhoto(tripId, paidA);

    expect(await removePhoto(photoId, asMember(paidA))).toEqual({ ok: true });

    const row = await getPhotoRow(photoId);
    // Hidden, never deleted: a removal has to stay reviewable.
    expect(row?.status).toBe("removed");
    expect(row?.removed_by_board_user_id).toBeNull();

    const photos = await listTripPhotos(tripId, asMember(paidA));
    expect(photos.some((p) => p.id === photoId)).toBe(false);
  });

  test("a non-board member cannot remove someone else's", async () => {
    const photoId = await insertPhoto(tripId, paidA);

    expect(await removePhoto(photoId, asMember(paidB))).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect((await getPhotoRow(photoId))?.status).toBe("ready");
  });

  test("an unauthenticated caller cannot remove anything", async () => {
    const photoId = await insertPhoto(tripId, paidA);

    expect(await removePhoto(photoId, ANONYMOUS_VIEWER)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect((await getPhotoRow(photoId))?.status).toBe("ready");
  });

  test("the board may remove any, and the removal is attributed", async () => {
    const photoId = await insertPhoto(tripId, paidA);

    expect(await removePhoto(photoId, asBoard(), "Rider asked for it to come down")).toEqual({
      ok: true,
    });

    const row = await getPhotoRow(photoId);
    expect(row?.status).toBe("removed");
    expect(row?.removed_by_board_user_id).toBe(boardUserId);
    expect(row?.removed_reason).toBe("Rider asked for it to come down");
  });

  test("a board member removing their own photo is not recorded as moderation", async () => {
    const photoId = await insertPhoto(tripId, paidA);

    expect(await removePhoto(photoId, asBoard(paidA))).toEqual({ ok: true });
    expect((await getPhotoRow(photoId))?.removed_by_board_user_id).toBeNull();
  });

  test("removing an unknown photo reports not_found", async () => {
    expect(await removePhoto(randomUUID(), asBoard())).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
