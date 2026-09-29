import { describe, test, expect, afterAll } from "vitest";
import { currentTermYear } from "@/lib/auth/authz";
import {
  NEW_MEMBER_DUES_CENTS,
  RETURNING_MEMBER_DUES_CENTS,
  getDuesStatus,
  getDuesStatusFor,
  waiveBoardDues,
} from "@/lib/money/dues";
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

async function makeBoardMember(
  label: string,
  opts: { active?: boolean } = {},
): Promise<{ memberId: string; email: string }> {
  const email = `dues-board-${label}-${Date.now()}-${Math.trunc(performance.now())}@colorado.edu`;
  const { rows } = await setupPool.query<{ id: string }>(
    `insert into members (email, first_name, last_name, email_verified_at)
     values ($1, 'Dues', $2, now()) returning id`,
    [email, label],
  );
  await setupPool.query(`insert into board_users (email, name, is_active) values ($1, $2, $3)`, [
    email,
    `Board ${label}`,
    opts.active ?? true,
  ]);
  return { memberId: rows[0].id, email };
}

afterAll(async () => {
  await setupPool.query(`delete from board_users where email like 'dues-%@colorado.edu'`);
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

describe("board waivers", () => {
  test("an active board member is comped and flagged, with no money recorded", async () => {
    const { memberId, email } = await makeBoardMember("comp");

    expect(await waiveBoardDues(email)).toBe(1);

    const status = await getDuesStatus(memberId);
    expect(status.paidThisSeason).toBe(true);
    expect(status.waivedThisSeason).toBe(true);
    expect(status.owedCents).toBe(0);

    const { rows } = await setupPool.query(
      `select d.amount_cents, d.waived, d.provider, m.is_club_member
         from member_dues d join members m on m.id = d.member_id
        where d.member_id = $1 and d.term_year = $2`,
      [memberId, season],
    );
    expect(rows[0]).toMatchObject({
      amount_cents: 0,
      waived: true,
      provider: "board",
      is_club_member: true,
    });
  });

  test("waiving twice records nothing new", async () => {
    const { email } = await makeBoardMember("twice");

    expect(await waiveBoardDues(email)).toBe(1);
    expect(await waiveBoardDues(email)).toBe(0);
  });

  test("a season already paid stays money; only the flag catches up", async () => {
    // Converting recorded money into a comp would write off a refund the
    // treasurer never issued - mirrors compBoardMembers leaving paid rows alone.
    const { memberId, email } = await makeBoardMember("paid-first");
    await recordSeason(memberId, season, NEW_MEMBER_DUES_CENTS);
    await setupPool.query(`update members set is_club_member = false where id = $1`, [memberId]);

    expect(await waiveBoardDues(email)).toBe(0);

    const status = await getDuesStatus(memberId);
    expect(status.paidThisSeason).toBe(true);
    expect(status.waivedThisSeason).toBe(false);

    const { rows } = await setupPool.query(`select is_club_member from members where id = $1`, [
      memberId,
    ]);
    expect(rows[0].is_club_member).toBe(true);
  });

  test("an inactive board user is not comped", async () => {
    const { memberId, email } = await makeBoardMember("inactive", { active: false });

    expect(await waiveBoardDues(email)).toBe(0);
    expect((await getDuesStatus(memberId)).owedCents).toBe(NEW_MEMBER_DUES_CENTS);
  });

  test("a priced waiver is unrepresentable", async () => {
    const id = await makeMember("waiver-shape");

    await expect(
      setupPool.query(
        `insert into member_dues (member_id, term_year, amount_cents, waived)
         values ($1, $2, 100, true)`,
        [id, season],
      ),
    ).rejects.toThrow(/member_dues_waived_free/);
  });

  test("a waived season still counts as returning later", async () => {
    // Someone who leaves the board is a returning member, not a newcomer.
    const id = await makeMember("ex-board");
    await setupPool.query(
      `insert into member_dues (member_id, term_year, amount_cents, waived)
       values ($1, $2, 0, true)`,
      [id, season - 1],
    );

    const status = await getDuesStatus(id);
    expect(status.returning).toBe(true);
    expect(status.owedCents).toBe(RETURNING_MEMBER_DUES_CENTS);
  });
});
