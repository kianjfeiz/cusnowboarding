-- Board members do not pay dues. Waive the current season for everyone active
-- on the board today; from here on waiveBoardDues() (src/lib/dues.ts) keeps
-- this true when board users are added, reactivated, or first sign in.
--
-- The season arithmetic mirrors currentTermYear() in src/lib/authz.ts:
-- August (month >= 8) in America/Denver starts the new term year.
--
-- A season already recorded as money is left alone (on conflict do nothing):
-- converting it to a waiver would write off a refund the treasurer never
-- issued. Board users with no members row yet are caught up at first sign-in.
with season as (
  select case
           when extract(month from (now() at time zone 'America/Denver')) >= 8
           then extract(year from (now() at time zone 'America/Denver'))
           else extract(year from (now() at time zone 'America/Denver')) - 1
         end::int as term_year
),
granted as (
  insert into member_dues (member_id, term_year, amount_cents, provider, waived, note)
  select m.id, s.term_year, 0, 'board', true, 'Board member - dues waived'
    from board_users b
    join members m on m.email = b.email
    cross join season s
   where b.is_active
     and not m.is_blocked
  on conflict (member_id, term_year) do nothing
)
update members m
   set is_club_member = true,
       updated_at = now()
  from board_users b
 where b.is_active
   and m.email = b.email
   and not m.is_blocked
   and not m.is_club_member;
