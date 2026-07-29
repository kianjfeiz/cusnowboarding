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
 */
export const NEW_MEMBER_DUES_CENTS = 25_000;
export const RETURNING_MEMBER_DUES_CENTS = 12_500;

export interface DuesStatus {
  /** Dues recorded for the current season. Mirrors members.is_club_member. */
  paidThisSeason: boolean;
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
  const rows = await execute<{ term_year: number }>(
    `select term_year from member_dues where member_id = $1 order by term_year desc`,
    [memberId],
  );

  const seasons = rows.map((r) => r.term_year);
  const paidThisSeason = seasons.includes(season);
  // Strictly EARLIER seasons. Paying for the current one does not make you
  // returning, or the rate would depend on the order the treasurer clicked in.
  const returning = seasons.some((year) => year < season);

  return {
    paidThisSeason,
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
  const rows = await execute<{ member_id: string; term_year: number }>(
    `select member_id, term_year from member_dues
      where member_id = any($1::uuid[])
      order by member_id, term_year desc`,
    [memberIds],
  );

  const bySeason = new Map<string, number[]>();
  for (const row of rows) {
    const list = bySeason.get(row.member_id) ?? [];
    list.push(row.term_year);
    bySeason.set(row.member_id, list);
  }

  for (const id of memberIds) {
    const seasons = bySeason.get(id) ?? [];
    const paidThisSeason = seasons.includes(season);
    const returning = seasons.some((year) => year < season);
    result.set(id, {
      paidThisSeason,
      returning,
      seasons,
      owedCents: paidThisSeason ? 0 : duesFor(returning),
    });
  }

  return result;
}
