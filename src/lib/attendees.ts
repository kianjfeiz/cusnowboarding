import { execute } from "@/lib/db";
import type { AttendeeFace } from "@/components/avatar";

/**
 * Who is on a trip, for member-facing views.
 *
 * "On the trip" means paid. A held-but-unpaid spot is not yet a person who is
 * going, and listing them would both mislead the reader and expose that someone
 * is about to lose their spot for non-payment.
 *
 * None of this is exposed until the board finalizes the roster - see
 * `trips.roster_finalized_at`.
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
      where s.trip_id = $1 and s.status = 'paid'
      -- Members with a photo first, so the visible faces are actual faces.
      order by (m.image_url is null), s.spot_number
      limit $2`,
    [tripId, faceLimit],
  );

  if (rows.length === 0) return { total: 0, faces: [] };

  return {
    total: rows[0].total,
    faces: rows.map((r) => ({ id: r.id, name: r.name, imageUrl: r.image_url })),
  };
}

export interface Attendee {
  memberId: string;
  name: string;
  email: string;
  imageUrl: string | null;
  spotNumber: number | null;
}

export async function listAttendees(tripId: string): Promise<Attendee[]> {
  const rows = await execute<{
    member_id: string;
    name: string;
    email: string;
    image_url: string | null;
    spot_number: number | null;
  }>(
    `select m.id as member_id,
            m.first_name || ' ' || m.last_name as name,
            m.email::text as email,
            m.image_url,
            s.spot_number
       from signups s
       join members m on m.id = s.member_id
      where s.trip_id = $1 and s.status = 'paid'
      order by s.spot_number`,
    [tripId],
  );

  return rows.map((r) => ({
    memberId: r.member_id,
    name: r.name,
    email: r.email,
    imageUrl: r.image_url,
    spotNumber: r.spot_number,
  }));
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

// ---------------------------------------------------------------------------
// A member's own trips
// ---------------------------------------------------------------------------

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
  const rows = await execute<{
    trip_id: string;
    slug: string;
    title: string;
    resort: string | null;
    depart_at: Date;
    return_at: Date | null;
    price_cents: number;
    amount_cents: number;
    status: string;
    spot_number: number | null;
    payment_deadline_at: Date | null;
    pay_token: string;
    board_seat: boolean;
    roster_finalized_at: Date | null;
    results_released: boolean;
    photo_count: number;
  }>(
    `select t.id as trip_id, t.slug, t.title, t.resort, t.depart_at, t.return_at,
            t.price_cents, s.amount_cents, s.status::text as status,
            s.spot_number, s.payment_deadline_at, s.pay_token, s.board_seat,
            t.roster_finalized_at,
            t.results_released_at is not null as results_released,
            coalesce(p.n, 0) as photo_count
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

  return rows.map((r) => ({
    tripId: r.trip_id,
    slug: r.slug,
    title: r.title,
    resort: r.resort,
    departAt: r.depart_at,
    returnAt: r.return_at,
    priceCents: r.price_cents,
    amountCents: r.amount_cents,
    status: r.status,
    spotNumber: r.spot_number,
    paymentDeadlineAt: r.payment_deadline_at,
    payToken: r.pay_token,
    boardSeat: r.board_seat,
    rosterFinalizedAt: r.roster_finalized_at,
    resultsReleased: r.results_released,
    photoCount: r.photo_count,
  }));
}
