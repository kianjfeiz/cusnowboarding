import { execute } from "@/lib/db";
import type { AttendeeFace } from "@/components/avatar";

/**
 * Who is on a trip, for member-facing views. "On the trip" means paid: listing
 * a held-but-unpaid spot would expose that someone is about to lose it. None of
 * this is exposed until `trips.roster_finalized_at` is set.
 */

export interface TripAttendance {
  total: number;
  faces: AttendeeFace[];
}

export async function getAttendeeFaces(
  tripId: string,
  faceLimit = 3,
): Promise<TripAttendance> {
  const rows = await execute<{
    id: string;
    name: string;
    image_url: string | null;
    total: number;
  }>(
    `select m.id,
            m.first_name || ' ' || m.last_name as name,
            m.image_url,
            count(*) over ()::int as total
       from signups s
       join members m on m.id = s.member_id
      -- Board seats are not spots, so they are not in the count members see.
      where s.trip_id = $1 and s.status = 'paid' and not s.board_seat
      -- Members with a photo first, so the visible faces are actual faces.
      order by (m.image_url is null), s.spot_number
      limit $2`,
    [tripId, faceLimit],
  );

  return {
    total: rows[0]?.total ?? 0,
    faces: rows.map((r) => ({ id: r.id, name: r.name, imageUrl: r.image_url })),
  };
}

export interface Attendee {
  memberId: string;
  name: string;
  email: string;
  imageUrl: string | null;
  spotNumber: number | null;
  /** A comped board rider: going, but not one of the trip's spots. */
  boardSeat: boolean;
}

export async function listAttendees(tripId: string): Promise<Attendee[]> {
  return execute<Attendee>(
    `select m.id as "memberId",
            m.first_name || ' ' || m.last_name as name,
            m.email::text as email,
            m.image_url as "imageUrl",
            s.spot_number as "spotNumber",
            s.board_seat as "boardSeat"
       from signups s
       join members m on m.id = s.member_id
      where s.trip_id = $1 and s.status = 'paid'
      order by s.spot_number`,
    [tripId],
  );
}

/** Whether a given member actually went, which is what gates the photo pool. */
export async function isTripAttendee(tripId: string, memberId: string): Promise<boolean> {
  const rows = await execute<{ ok: boolean }>(
    /*
      The archived check belongs here rather than on each caller. This is the
      single gate behind the photo pool and the ride sheet, and both are
      reachable by API with a trip id alone - the pages 404ing on an archived
      trip would not have closed either of them.
    */
    `select true as ok
       from signups s
       join trips t on t.id = s.trip_id
      where s.trip_id = $1 and s.member_id = $2 and s.status = 'paid'
        and t.archived_at is null
      limit 1`,
    [tripId, memberId],
  );
  return rows.length > 0;
}

export interface MemberTrip {
  tripId: string;
  slug: string;
  title: string;
  resort: string | null;
  departAt: Date;
  returnAt: Date | null;
  priceCents: number;
  amountCents: number;
  status: string;
  spotNumber: number | null;
  paymentDeadlineAt: Date | null;
  payToken: string;
  /** Comped board rider: nothing owed on this one, ever. */
  boardSeat: boolean;
  rosterFinalizedAt: Date | null;
  /** Members see no outcome at all until the board publishes results. */
  resultsReleased: boolean;
  photoCount: number;
}

export async function listMemberTrips(memberId: string): Promise<MemberTrip[]> {
  return execute<MemberTrip>(
    `select t.id as "tripId", t.slug, t.title, t.resort,
            t.depart_at as "departAt", t.return_at as "returnAt",
            t.price_cents as "priceCents", s.amount_cents as "amountCents",
            s.status::text as status, s.spot_number as "spotNumber",
            s.payment_deadline_at as "paymentDeadlineAt", s.pay_token as "payToken",
            s.board_seat as "boardSeat", t.roster_finalized_at as "rosterFinalizedAt",
            t.results_released_at is not null as "resultsReleased",
            coalesce(p.n, 0) as "photoCount"
       from signups s
       join trips t on t.id = s.trip_id
       left join lateral (
         select count(*)::int as n from trip_photos
          where trip_id = t.id and status = 'ready'
       ) p on true
      where s.member_id = $1
        and s.status in ('held','paid','waitlisted')
        and t.archived_at is null
      order by t.depart_at desc`,
    [memberId],
  );
}
