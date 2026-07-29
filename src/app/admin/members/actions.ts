"use server";

import { revalidatePath } from "next/cache";
import { execute } from "@/lib/db";
import { currentTermYear } from "@/lib/authz";
import {
  NEW_MEMBER_DUES_CENTS,
  RETURNING_MEMBER_DUES_CENTS,
  duesFor,
  getDuesStatus,
} from "@/lib/dues";
import { requireCapability } from "../_lib/actor";
import { recordAudit } from "../_lib/audit";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function flag(formData: FormData, key: string): boolean {
  return text(formData, key) === "true";
}

function refreshMembers(): void {
  revalidatePath("/admin/members");
}

type MemberIdentity = { email: string; first_name: string; last_name: string };

async function loadMember(memberId: string): Promise<MemberIdentity> {
  const rows = await execute<MemberIdentity>(
    `select email::text as email, first_name, last_name from members where id = $1`,
    [memberId],
  );
  const row = rows[0];
  if (!row) throw new Error("Member not found");
  return row;
}

// ---------------------------------------------------------------------------
// Single-member flags
// ---------------------------------------------------------------------------

/**
 * Blocking bumps token_version as well as setting the flag. The member is
 * carrying a signed csc_member cookie that the claim path trusts without a
 * database read, so the flag on its own would not stop them claiming a spot;
 * the version bump is what invalidates that cookie.
 *
 * There is no matching "unverify" control. Signing in with Google is what marks
 * a member verified, and it is the only way in, so clearing the flag would be
 * undone by the member's next sign-in. Blocking is the control that holds.
 */
export async function setMemberBlocked(formData: FormData): Promise<void> {
  // Moderation, not board administration - the coordinator running the trip
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
 * statement reads, and `member_dues` is the history that decides whether this
 * person pays the returning rate next year. Setting only the flag would work
 * today and quietly overcharge them next season.
 *
 * Clearing removes only the current season's row. Earlier seasons are what make
 * someone a returning member, and undoing a misclick must not erase that.
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
      `insert into member_dues (member_id, term_year, amount_cents, provider, note, recorded_by)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (member_id, term_year) do nothing`,
      [
        memberId,
        season,
        duesFor(status.returning),
        text(formData, "provider") || "fusion",
        text(formData, "note") || null,
        actor.boardUserId,
      ],
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

// ---------------------------------------------------------------------------
// Bulk dues import
// ---------------------------------------------------------------------------

export interface DuesImportState {
  error?: string;
  result?: {
    submitted: number;
    matched: number;
    newlyMarked: number;
    unmatched: string[];
  };
}

/** Cheap enough to run on a 400-line paste, and it survives quoted CSV cells and `Name <addr>` forms. */
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
 * The treasurer's roster export is the source of truth for dues, but it is not
 * the source of truth for who exists. An address with no member row is reported
 * back rather than inserted: a member created here would have no verified email
 * and no name, and would sit in the roster looking like a real signup.
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

  // `matched` reads the pre-update snapshot, so was_member distinguishes rows
  // this import actually changed from rows that were already marked.
  /**
   * One statement so the flag and the season row cannot diverge. The rate is
   * decided per member from whether they have a row in an EARLIER season - the
   * same rule as the single-member path, applied in SQL so a 300-row import
   * does not become 300 round trips.
   */
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

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "member.dues.import",
    entityType: "member",
    data: {
      submitted: emails.length,
      matched: matched.length,
      newlyMarked,
      unmatched,
    },
  });

  refreshMembers();

  return {
    result: { submitted: emails.length, matched: matched.length, newlyMarked, unmatched },
  };
}
