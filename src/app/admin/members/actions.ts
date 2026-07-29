"use server";

import { revalidatePath } from "next/cache";
import { execute } from "@/lib/db";
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
 * Verifying by hand is for the case the code email never arrived. Clearing
 * verification is the interesting direction: the member is still carrying a
 * signed csc_member cookie that the claim path trusts without a database read,
 * so the flag alone would not stop them. Bumping token_version is what actually
 * invalidates that cookie.
 */
export async function setMemberVerified(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageBoard");

  const memberId = text(formData, "memberId");
  const verified = flag(formData, "verified");
  const member = await loadMember(memberId);

  await execute(
    `update members
        set email_verified_at = case when $2 then coalesce(email_verified_at, now()) else null end,
            token_version = case when $2 then token_version else token_version + 1 end,
            updated_at = now()
      where id = $1`,
    [memberId, verified],
  );

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: verified ? "member.verify" : "member.unverify",
    entityType: "member",
    entityId: memberId,
    data: { email: member.email },
  });

  refreshMembers();
}

/** Same reasoning as clearing verification: a block that leaves a live cookie in place is not a block. */
export async function setMemberBlocked(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageBoard");

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

export async function setMemberDues(formData: FormData): Promise<void> {
  const actor = await requireCapability("managePayments");

  const memberId = text(formData, "memberId");
  const paid = flag(formData, "paid");
  const member = await loadMember(memberId);

  await execute(
    `update members set is_club_member = $2, updated_at = now() where id = $1`,
    [memberId, paid],
  );

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: paid ? "member.dues.mark" : "member.dues.clear",
    entityType: "member",
    entityId: memberId,
    data: { email: member.email },
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
     )
     select email, was_member from matched`,
    [emails],
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
