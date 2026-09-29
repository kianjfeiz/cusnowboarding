"use server";

import { revalidatePath } from "next/cache";
import { execute } from "@/lib/db";
import { currentTermYear } from "@/lib/auth/authz";
import {
  NEW_MEMBER_DUES_CENTS,
  RETURNING_MEMBER_DUES_CENTS,
  duesFor,
  getDuesStatus,
} from "@/lib/money/dues";
import { requireCapability } from "../_lib/actor";
import { recordAudit } from "../_lib/audit";
import { text } from "../_lib/form";

function flag(formData: FormData, key: string): boolean {
  return text(formData, key) === "true";
}

function refreshMembers(): void {
  revalidatePath("/admin/members");
}

/** Confirms the member exists before anything is written, and names them for the audit row. */
async function loadMember(memberId: string): Promise<{ email: string }> {
  const rows = await execute<{ email: string }>(
    `select email::text as email from members where id = $1`,
    [memberId],
  );
  const row = rows[0];
  if (!row) throw new Error("Member not found");
  return row;
}

/**
 * Blocking bumps token_version as well as setting the flag. The claim path
 * trusts the signed csc_member cookie without a database read, so the flag on
 * its own would not stop a claim; the version bump is what invalidates the
 * cookie.
 */
export async function setMemberBlocked(formData: FormData): Promise<void> {
  // Moderation, not board administration: the coordinator running the trip
  // needs this on a Friday night, not just the president.
  const actor = await requireCapability("manageMembers");

  const memberId = text(formData, "memberId");
  const blocked = flag(formData, "blocked");
  const member = await loadMember(memberId);

  await execute(
    `update members
        set is_blocked = $2,
            token_version = case when $2 then token_version + 1 else token_version end,
            updated_at = now()
      where id = $1`,
    [memberId, blocked],
  );

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: blocked ? "member.block" : "member.unblock",
    entityType: "member",
    entityId: memberId,
    data: { email: member.email },
  });

  refreshMembers();
}

/**
 * Records or clears dues for the CURRENT season.
 *
 * Two writes, deliberately: `members.is_club_member` is the fast flag the claim
 * statement reads, and `member_dues` is the history that decides the returning
 * rate next year. Clearing removes only this season's row, so undoing a
 * misclick cannot erase what makes someone a returning member.
 */
export async function setMemberDues(formData: FormData): Promise<void> {
  const actor = await requireCapability("managePayments");

  const memberId = text(formData, "memberId");
  const paid = flag(formData, "paid");
  const member = await loadMember(memberId);
  const season = currentTermYear();

  // Read before writing so the rate reflects prior seasons, not this one.
  const status = await getDuesStatus(memberId);

  await execute(
    `update members set is_club_member = $2, updated_at = now() where id = $1`,
    [memberId, paid],
  );

  if (paid) {
    await execute(
      `insert into member_dues (member_id, term_year, amount_cents, provider, recorded_by)
       values ($1, $2, $3, 'fusion', $4)
       on conflict (member_id, term_year) do nothing`,
      [memberId, season, duesFor(status.returning), actor.boardUserId],
    );
  } else {
    await execute(`delete from member_dues where member_id = $1 and term_year = $2`, [
      memberId,
      season,
    ]);
  }

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: paid ? "member.dues.mark" : "member.dues.clear",
    entityType: "member",
    entityId: memberId,
    data: {
      email: member.email,
      termYear: season,
      amountCents: paid ? duesFor(status.returning) : null,
      returning: status.returning,
    },
  });

  refreshMembers();
}

export interface DuesImportState {
  error?: string;
  result?: {
    submitted: number;
    matched: number;
    newlyMarked: number;
    unmatched: string[];
  };
}

/** Survives quoted CSV cells and `Name <addr>` forms. */
const EMAIL_TOKEN = /[^\s,;<>"']+@[^\s,;<>"']+/g;

const MAX_EMAILS = 2000;

function extractEmails(raw: string): string[] {
  const seen = new Set<string>();
  for (const match of raw.match(EMAIL_TOKEN) ?? []) {
    const email = match.replace(/[.,;)\]]+$/, "").toLowerCase();
    if (email.length > 3) seen.add(email);
  }
  return [...seen];
}

/**
 * An address with no member row is reported back rather than inserted: a member
 * created here would have no Google sign-in and no name, and would sit in the
 * roster looking like a real signup.
 */
export async function importDues(
  _prev: DuesImportState,
  formData: FormData,
): Promise<DuesImportState> {
  const actor = await requireCapability("managePayments");

  const emails = extractEmails(String(formData.get("emails") ?? ""));
  if (emails.length === 0) {
    return { error: "No email addresses found in that paste." };
  }
  if (emails.length > MAX_EMAILS) {
    return { error: `That is ${emails.length} addresses. Import ${MAX_EMAILS} or fewer at a time.` };
  }

  // One statement so the flag and the season row cannot diverge. The rate comes
  // from whether the member has a row in an EARLIER season, the same rule as
  // the single-member path. `matched` reads the pre-update snapshot, so
  // was_member separates rows this import changed from rows already marked.
  const season = currentTermYear();
  const matched = await execute<{ email: string; was_member: boolean }>(
    `with matched as (
       select id, email::text as email, is_club_member as was_member
         from members
        where email = any($1::citext[])
     ),
     updated as (
       update members
          set is_club_member = true, updated_at = now()
        where id in (select id from matched) and not is_club_member
     ),
     recorded as (
       insert into member_dues (member_id, term_year, amount_cents, provider, recorded_by)
       select m.id,
              $2::int,
              case when exists (
                     select 1 from member_dues d
                      where d.member_id = m.id and d.term_year < $2::int
                   ) then $3::int else $4::int end,
              'fusion',
              $5::uuid
         from matched m
       on conflict (member_id, term_year) do nothing
     )
     select email, was_member from matched`,
    [
      emails,
      season,
      RETURNING_MEMBER_DUES_CENTS,
      NEW_MEMBER_DUES_CENTS,
      actor.boardUserId,
    ],
  );

  const found = new Set(matched.map((row) => row.email.toLowerCase()));
  const unmatched = emails.filter((email) => !found.has(email));
  const newlyMarked = matched.filter((row) => !row.was_member).length;

  const result = {
    submitted: emails.length,
    matched: matched.length,
    newlyMarked,
    unmatched,
  };

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "member.dues.import",
    entityType: "member",
    data: result,
  });

  refreshMembers();
  return { result };
}
