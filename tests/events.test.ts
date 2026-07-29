import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { pool } from "@/lib/db";
import {
  denverDayStart,
  gridRange,
  listCalendarItems,
  listUpcomingCalendarItems,
  monthRange,
  monthWeeks,
  validateEventWindow,
  type CalendarItem,
  type ClubEventStatus,
} from "@/lib/events";
import { createTestTrip, deleteTestTrips, setupPool } from "./helpers";

/**
 * Everything here writes rows with a recognisable slug prefix and deletes them
 * again, because this suite runs against the same local database as the race
 * suite and a stray published event would show up on someone's calendar.
 */
const SLUG_PREFIX = "test-event-";

let eventCounter = 0;

interface TestEventOptions {
  title?: string;
  startsAt: string;
  endsAt?: string | null;
  status?: ClubEventStatus;
  kind?: string;
}

/** Times are given as Denver wall-clock strings, which is how the board thinks. */
async function createTestEvent(opts: TestEventOptions): Promise<string> {
  const slug = `${SLUG_PREFIX}${process.pid}-${++eventCounter}-${Date.now()}`;
  const { rows } = await setupPool.query<{ id: string }>(
    `insert into events (slug, title, kind, starts_at, ends_at, status)
     values ($1, $2, $3::event_kind,
             ($4::text)::timestamp at time zone 'America/Denver',
             case when $5::text is null then null
                  else ($5::text)::timestamp at time zone 'America/Denver' end,
             $6::event_status)
     returning id`,
    [
      slug,
      opts.title ?? `Test ${slug}`,
      opts.kind ?? "party",
      opts.startsAt,
      opts.endsAt ?? null,
      opts.status ?? "published",
    ],
  );
  return rows[0].id;
}

async function moveTrip(tripId: string, departAt: string, returnAt: string | null) {
  await setupPool.query(
    `update trips
        set depart_at = ($2::text)::timestamp at time zone 'America/Denver',
            return_at = case when $3::text is null then null
                             else ($3::text)::timestamp at time zone 'America/Denver' end
      where id = $1`,
    [tripId, departAt, returnAt],
  );
}

async function deleteTestEvents() {
  await setupPool.query(`delete from events where slug like '${SLUG_PREFIX}%'`);
}

const titles = (items: CalendarItem[]) => items.map((i) => i.title);
const kinds = (items: CalendarItem[]) => items.map((i) => i.kind);

/** January 2026 in Denver, as instants. */
const JANUARY = monthRange({ year: 2026, month: 1 });
const FEBRUARY = monthRange({ year: 2026, month: 2 });

beforeEach(async () => {
  await deleteTestEvents();
  await deleteTestTrips();
});

afterAll(async () => {
  await deleteTestEvents();
  await deleteTestTrips();
  await setupPool.end();
  await pool.end();
});

describe("merged calendar feed", () => {
  test("events and trips come back as one chronological list", async () => {
    await createTestEvent({ title: "Late party", startsAt: "2026-01-20 21:00:00" });
    await createTestEvent({ title: "Early meeting", startsAt: "2026-01-05 18:00:00" });

    const tripId = await createTestTrip({ status: "open" });
    await moveTrip(tripId, "2026-01-10 06:00:00", "2026-01-11 20:00:00");

    const items = await listCalendarItems(JANUARY);

    expect(titles(items)).toEqual([
      "Early meeting",
      expect.stringContaining("Test test-trip-"),
      "Late party",
    ]);
    expect(kinds(items)).toEqual(["event", "trip", "event"]);
  });

  test("a trip carries its depart and return times and links to its page", async () => {
    const tripId = await createTestTrip({ status: "scheduled" });
    await moveTrip(tripId, "2026-01-16 05:30:00", "2026-01-18 22:00:00");

    const [item] = await listCalendarItems(JANUARY);
    expect(item.kind).toBe("trip");
    if (item.kind !== "trip") throw new Error("expected a trip");

    expect(item.id).toBe(tripId);
    expect(item.startsAt.toISOString()).toBe("2026-01-16T12:30:00.000Z");
    expect(item.endsAt?.toISOString()).toBe("2026-01-19T05:00:00.000Z");
  });

  test("ties are broken by title so ordering is stable", async () => {
    await createTestEvent({ title: "Bravo", startsAt: "2026-01-08 19:00:00" });
    await createTestEvent({ title: "Alpha", startsAt: "2026-01-08 19:00:00" });

    expect(titles(await listCalendarItems(JANUARY))).toEqual(["Alpha", "Bravo"]);
  });
});

describe("month filtering", () => {
  test("only the requested month comes back", async () => {
    await createTestEvent({ title: "December", startsAt: "2025-12-30 19:00:00" });
    await createTestEvent({ title: "January", startsAt: "2026-01-15 19:00:00" });
    await createTestEvent({ title: "February", startsAt: "2026-02-02 19:00:00" });

    expect(titles(await listCalendarItems(JANUARY))).toEqual(["January"]);
    expect(titles(await listCalendarItems(FEBRUARY))).toEqual(["February"]);
  });

  test("an event spanning the month boundary appears in both months", async () => {
    await createTestEvent({
      title: "Season closer",
      startsAt: "2026-01-30 18:00:00",
      endsAt: "2026-02-02 12:00:00",
    });

    expect(titles(await listCalendarItems(JANUARY))).toEqual(["Season closer"]);
    expect(titles(await listCalendarItems(FEBRUARY))).toEqual(["Season closer"]);
  });

  test("a trip spanning the month boundary appears in both months", async () => {
    const tripId = await createTestTrip({ status: "open" });
    await moveTrip(tripId, "2026-01-31 05:00:00", "2026-02-01 21:00:00");

    expect((await listCalendarItems(JANUARY)).length).toBe(1);
    expect((await listCalendarItems(FEBRUARY)).length).toBe(1);
  });

  test("an event ending exactly at midnight belongs to the month it started in", async () => {
    await createTestEvent({
      title: "New year",
      startsAt: "2026-01-31 20:00:00",
      endsAt: "2026-02-01 00:00:00",
    });

    expect(titles(await listCalendarItems(JANUARY))).toEqual(["New year"]);
    expect(titles(await listCalendarItems(FEBRUARY))).toEqual([]);
  });

  test("the rendered grid covers the leading and trailing days of the month", async () => {
    // January 2026 starts on a Thursday, so the grid opens on Sunday Dec 28.
    await createTestEvent({ title: "Leading week", startsAt: "2025-12-29 19:00:00" });

    const range = gridRange(monthWeeks({ year: 2026, month: 1 }));
    expect(range.from.getTime()).toBe(denverDayStart("2025-12-28").getTime());

    expect(titles(await listCalendarItems(range))).toEqual(["Leading week"]);
    expect(titles(await listCalendarItems(JANUARY))).toEqual([]);
  });
});

describe("what members are allowed to see", () => {
  test("draft and cancelled events are excluded, published ones appear", async () => {
    await createTestEvent({ title: "Draft", startsAt: "2026-01-12 19:00:00", status: "draft" });
    await createTestEvent({
      title: "Cancelled",
      startsAt: "2026-01-13 19:00:00",
      status: "cancelled",
    });
    await createTestEvent({
      title: "Published",
      startsAt: "2026-01-14 19:00:00",
      status: "published",
    });

    expect(titles(await listCalendarItems(JANUARY))).toEqual(["Published"]);
  });

  test("draft and cancelled trips are excluded too", async () => {
    const draft = await createTestTrip({ status: "draft" });
    await moveTrip(draft, "2026-01-09 06:00:00", null);
    const cancelled = await createTestTrip({ status: "cancelled" });
    await moveTrip(cancelled, "2026-01-10 06:00:00", null);
    const open = await createTestTrip({ status: "open" });
    await moveTrip(open, "2026-01-11 06:00:00", null);

    const items = await listCalendarItems(JANUARY);
    expect(items.map((i) => i.id)).toEqual([open]);
  });

  test("upcoming spans from now forwards and includes something in progress", async () => {
    const now = new Date();
    const inProgress = await createTestEvent({
      title: "Happening now",
      startsAt: denverInput(new Date(now.getTime() - 3_600_000)),
      endsAt: denverInput(new Date(now.getTime() + 3_600_000)),
    });
    expect(inProgress).toBeTruthy();

    await createTestEvent({
      title: "Next week",
      startsAt: denverInput(new Date(now.getTime() + 7 * 24 * 3_600_000)),
    });
    await createTestEvent({
      title: "Months away",
      startsAt: denverInput(new Date(now.getTime() + 120 * 24 * 3_600_000)),
    });

    const upcoming = await listUpcomingCalendarItems({ weeks: 6, now });

    // Seed trips share this database, so assert on the rows this test owns.
    const mine = titles(upcoming).filter((title) =>
      ["Happening now", "Next week", "Months away"].includes(title),
    );
    expect(mine).toEqual(["Happening now", "Next week"]);

    const starts = upcoming.map((item) => item.startsAt.getTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe("start and end validation", () => {
  test("an end before the start is refused with a readable message", () => {
    const start = new Date("2026-01-30T02:00:00Z");
    const before = new Date("2026-01-30T01:00:00Z");

    expect(validateEventWindow(start, before)).toBe("The end time is before the start time.");
    expect(validateEventWindow(start, null)).toBeNull();
    expect(validateEventWindow(start, start)).toBeNull();
    expect(validateEventWindow(start, new Date("2026-01-30T03:00:00Z"))).toBeNull();
  });

  test("the database refuses it too, so a bad write cannot slip past the form", async () => {
    await expect(
      createTestEvent({
        title: "Backwards",
        startsAt: "2026-01-30 21:00:00",
        endsAt: "2026-01-30 19:00:00",
      }),
    ).rejects.toThrow(/events_end_after_start/);
  });
});

/** `YYYY-MM-DD HH:mm:ss` in Denver, which is what the insert helper expects. */
function denverInput(at: Date): string {
  return at
    .toLocaleString("sv-SE", { timeZone: "America/Denver", hour12: false })
    .replace("T", " ");
}
