import { execute } from "@/lib/db";
import { currentTermYear } from "@/lib/authz";

/**
 * Club dues.
 *
 * Two rates: someone who has paid dues in any previous season pays the
 * returning rate. That is why `member_dues` keeps a row per season rather than
 * a single boolean - "have they ever paid before" is not recoverable from a
 * flag, and asking the treasurer to remember it across a board handover is how
 * people get charged the wrong amount.
 *
 * Board members do not pay at all - see `waiveBoardDues` below.
 */
export const NEW_MEMBER_DUES_CENTS = 25_000;
export const RETURNING_MEMBER_DUES_CENTS = 12_500;

export interface DuesStatus {
  /** Dues recorded for the current season. Mirrors members.is_club_member. */
  paidThisSeason: boolean;
  /** This season is a board waiver, not money - read "Waived", not "Paid". */
  waivedThisSeason: boolean;
  /** Paid in at least one earlier season, so they get the returning rate. */
  returning: boolean;
  /** Seasons they have paid for, newest first. */
  seasons: number[];
  /** What they owe this season, given whether they are returning. */
  owedCents: number;
}

export function duesFor(returning: boolean): number {
  return returning ? RETURNING_MEMBER_DUES_CENTS : NEW_MEMBER_DUES_CENTS;
}

/** "2026-27", the way the board says it out loud. */
export function seasonLabel(termYear: number): string {
  return `${termYear}-${String((termYear + 1) % 100).padStart(2, "0")}`;
}

export async function getDuesStatus(memberId: string): Promise<DuesStatus> {
  const season = currentTermYear();
  const rows = await execute<{ term_year: number; waived: boolean }>(
    `select term_year, waived from member_dues where member_id = $1 order by term_year desc`,
    [memberId],
  );

  const seasons = rows.map((r) => r.term_year);
  const paidThisSeason = seasons.includes(season);
  // Strictly EARLIER seasons. Paying for the current one does not make you
  // returning, or the rate would depend on the order the treasurer clicked in.
  // A waived season counts: someone who leaves the board is a returning
  // member, not a newcomer to be charged the first-season rate.
  const returning = seasons.some((year) => year < season);

  return {
    paidThisSeason,
    waivedThisSeason: rows.some((r) => r.term_year === season && r.waived),
    returning,
    seasons,
    owedCents: paidThisSeason ? 0 : duesFor(returning),
  };
}

/** Dues status for a page of members, in one query rather than N. */
export async function getDuesStatusFor(
  memberIds: string[],
): Promise<Map<string, DuesStatus>> {
  const result = new Map<string, DuesStatus>();
  if (memberIds.length === 0) return result;

  const season = currentTermYear();
  const rows = await execute<{ member_id: string; term_year: number; waived: boolean }>(
    `select member_id, term_year, waived from member_dues
      where member_id = any($1::uuid[])
      order by member_id, term_year desc`,
    [memberIds],
  );

  const bySeason = new Map<string, { term_year: number; waived: boolean }[]>();
  for (const row of rows) {
    const list = bySeason.get(row.member_id) ?? [];
    list.push(row);
    bySeason.set(row.member_id, list);
  }

  for (const id of memberIds) {
    const recorded = bySeason.get(id) ?? [];
    const seasons = recorded.map((r) => r.term_year);
    const paidThisSeason = seasons.includes(season);
    const returning = seasons.some((year) => year < season);
    result.set(id, {
      paidThisSeason,
      waivedThisSeason: recorded.some((r) => r.term_year === season && r.waived),
      returning,
      seasons,
      owedCents: paidThisSeason ? 0 : duesFor(returning),
    });
  }

  return result;
}

/**
 * The board does not pay dues.
 *
 * Comped the way a board trip seat is (src/lib/board-seats.ts): a real
 * `member_dues` row with amount zero and `waived` set, plus the
 * `is_club_member` flag, so the claim's dues gate and the returning-rate
 * history both stay ordinary reads that never learn about the board. A season
 * already recorded as money is left alone - converting it would silently
 * write off a refund the treasurer never issued.
 *
 * Idempotent, and scoped to one address because every caller has one: the
 * board add and reactivate actions, and the sign-in link. Nobody is un-waived
 * here: someone leaving the board mid-season keeps the season they served,
 * and "Clear dues" exists for the treasurer who decides otherwise.
 *
 * Returns 1 if a season was newly waived, else 0.
 */
export async function waiveBoardDues(email: string): Promise<number> {
  const rows = await execute<{ granted: number }>(
    `with granted as (
       insert into member_dues (member_id, term_year, amount_cents, provider, waived, note)
       select m.id, $1::int, 0, 'board', true, 'Board member - dues waived'
         from board_users b
         join members m on m.email = b.email
        where b.is_active
          and not m.is_blocked
          and b.email = $2
       on conflict (member_id, term_year) do nothing
       returning member_id
     ),
     -- Flag the member even when nothing was granted: one who already paid
     -- this season has no waiver row but is settled all the same.
     flagged as (
       update members m
          set is_club_member = true,
              updated_at = now()
         from board_users b
        where b.is_active
          and m.email = b.email
          and not m.is_blocked
          and not m.is_club_member
          and m.email = $2
       returning m.id
     )
     select (select count(*) from granted)::int as granted`,
    [currentTermYear(), email],
  );

  return rows[0]?.granted ?? 0;
}
