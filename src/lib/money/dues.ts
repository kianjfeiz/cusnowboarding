import { execute } from "@/lib/db";
import { currentTermYear } from "@/lib/auth/authz";

/**
 * Club dues. Two rates: someone who has paid dues in any previous season pays
 * the returning rate, which is why `member_dues` keeps a row per season rather
 * than a single boolean. Board members do not pay at all - see `waiveBoardDues`.
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

export async function getDuesStatus(memberId: string): Promise<DuesStatus> {
  return (await getDuesStatusFor([memberId])).get(memberId)!;
}

/** Dues status for a page of members, in one query rather than N. */
export async function getDuesStatusFor(
  memberIds: string[],
): Promise<Map<string, DuesStatus>> {
  const result = new Map<string, DuesStatus>();
  if (memberIds.length === 0) return result;

  const season = currentTermYear();
  const rows = await execute<{ member_id: string; seasons: number[]; waived: boolean }>(
    `select member_id,
            array_agg(term_year order by term_year desc) as seasons,
            bool_or(term_year = $2 and waived) as waived
       from member_dues
      where member_id = any($1::uuid[])
      group by member_id`,
    [memberIds, season],
  );
  const recorded = new Map(rows.map((row) => [row.member_id, row]));

  for (const id of memberIds) {
    const { seasons = [], waived = false } = recorded.get(id) ?? {};
    const paidThisSeason = seasons.includes(season);
    // Strictly EARLIER seasons. Paying for the current one does not make you
    // returning, or the rate would depend on the order the treasurer clicked in.
    // A waived season counts: someone who leaves the board is a returning
    // member, not a newcomer to be charged the first-season rate.
    const returning = seasons.some((year) => year < season);
    result.set(id, {
      paidThisSeason,
      waivedThisSeason: waived,
      returning,
      seasons,
      owedCents: paidThisSeason ? 0 : duesFor(returning),
    });
  }

  return result;
}

/**
 * The board does not pay dues. Comped the way a board trip seat is: a real
 * `member_dues` row with amount zero and `waived` set, plus the
 * `is_club_member` flag, so the claim's dues gate stays a flag read that never
 * learns about the board. A season already recorded as money is left alone -
 * converting it would silently write off a refund the treasurer never issued.
 *
 * Idempotent. Nobody is un-waived here: someone leaving the board keeps the
 * season they served, and "Clear dues" is the manual override.
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
