import { describe, test, expect, afterAll } from "vitest";
import { currentTermYear } from "@/lib/authz";
import {
  NEW_MEMBER_DUES_CENTS,
  RETURNING_MEMBER_DUES_CENTS,
  getDuesStatus,
  getDuesStatusFor,
  seasonLabel,
} from "@/lib/dues";
import { pool } from "@/lib/db";
import { setupPool } from "./helpers";

const season = currentTermYear();

async function makeMember(label: string): Promise<string> {
  const { rows } = await setupPool.query<{ id: string }>(
    `insert into members (email, first_name, last_name, email_verified_at)
     values ($1, 'Dues', $2, now()) returning id`,
    [`dues-${label}-${Date.now()}-${Math.trunc(performance.now())}@colorado.edu`, label],
  );
  return rows[0].id;
}

async function recordSeason(memberId: string, year: number, cents: number) {
  await setupPool.query(
    `insert into member_dues (member_id, term_year, amount_cents) values ($1, $2, $3)`,
    [memberId, year, cents],
  );
}

afterAll(async () => {
  await setupPool.query(`delete from members where email like 'dues-%@colorado.edu'`);
  await setupPool.end();
  await pool.end();
});

describe("dues rates", () => {
  test("someone with no history owes the first-season rate", async () => {
    const id = await makeMember("new");
    const status = await getDuesStatus(id);

    expect(status.returning).toBe(false);
    expect(status.paidThisSeason).toBe(false);
    expect(status.owedCents).toBe(NEW_MEMBER_DUES_CENTS);
  });

  test("someone who paid a previous season owes the returning rate", async () => {
    const id = await makeMember("returning");
    await recordSeason(id, season - 1, NEW_MEMBER_DUES_CENTS);

    const status = await getDuesStatus(id);
    expect(status.returning).toBe(true);
    expect(status.owedCents).toBe(RETURNING_MEMBER_DUES_CENTS);
  });

  test("a gap year still counts as returning", async () => {
    // The rule is "has ever paid before", not "paid last season" - someone who
    // skipped a year is not a new member.
    const id = await makeMember("gap");
    await recordSeason(id, season - 3, NEW_MEMBER_DUES_CENTS);

    const status = await getDuesStatus(id);
    expect(status.returning).toBe(true);
    expect(status.owedCents).toBe(RETURNING_MEMBER_DUES_CENTS);
  });

  test("paying the current season does not by itself make someone returning", async () => {
    // Otherwise the rate would depend on the order the treasurer clicked in.
    const id = await makeMember("current");
    await recordSeason(id, season, NEW_MEMBER_DUES_CENTS);

    const status = await getDuesStatus(id);
    expect(status.paidThisSeason).toBe(true);
    expect(status.returning).toBe(false);
    expect(status.owedCents).toBe(0);
  });

  test("owes nothing once the current season is recorded", async () => {
    const id = await makeMember("settled");
    await recordSeason(id, season - 1, NEW_MEMBER_DUES_CENTS);
    await recordSeason(id, season, RETURNING_MEMBER_DUES_CENTS);

    const status = await getDuesStatus(id);
    expect(status.returning).toBe(true);
    expect(status.paidThisSeason).toBe(true);
    expect(status.owedCents).toBe(0);
  });

  test("one season may only be recorded once", async () => {
    const id = await makeMember("dupe");
    await recordSeason(id, season, NEW_MEMBER_DUES_CENTS);

    await expect(recordSeason(id, season, NEW_MEMBER_DUES_CENTS)).rejects.toThrow();
  });

  test("the batch lookup agrees with the single lookup", async () => {
    const fresh = await makeMember("batch-new");
    const veteran = await makeMember("batch-old");
    await recordSeason(veteran, season - 2, NEW_MEMBER_DUES_CENTS);

    const batch = await getDuesStatusFor([fresh, veteran]);

    expect(batch.get(fresh)!.owedCents).toBe(NEW_MEMBER_DUES_CENTS);
    expect(batch.get(veteran)!.owedCents).toBe(RETURNING_MEMBER_DUES_CENTS);
    expect(batch.get(veteran)).toEqual(await getDuesStatus(veteran));
  });

  test("an empty batch does not query", async () => {
    expect((await getDuesStatusFor([])).size).toBe(0);
  });
});

describe("season labels", () => {
  test("reads the way the board says it", () => {
    expect(seasonLabel(2026)).toBe("2026-27");
    expect(seasonLabel(2099)).toBe("2099-00");
  });
});
