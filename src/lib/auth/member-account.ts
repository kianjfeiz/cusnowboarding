import { and, eq, isNotNull } from "drizzle-orm";
import { db, execute } from "@/lib/db";
import { members, type Member } from "@/lib/db/schema";
import { waiveBoardDues } from "@/lib/money/dues";

/**
 * Links a Google identity to a `members` row.
 *
 * Signing in with Google IS verification - there is no other way to become
 * verified. And board members are members: board status is an attribute of a
 * person, so every Google sign-in resolves to a member row regardless.
 */
export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string | null;
  picture?: string | null;
}

export interface LinkedMember {
  id: string;
  tokenVersion: number;
  email: string;
  firstName: string;
  lastName: string;
  /** Null until the member has typed their own name once - see the welcome page. */
  nameConfirmedAt: Date | null;
}

const LINKED_COLUMNS = `
  id, token_version as "tokenVersion", email::text as email,
  first_name as "firstName", last_name as "lastName",
  name_confirmed_at as "nameConfirmedAt"
`;

function splitName(name: string | null | undefined, email: string): [string, string] {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return [email.split("@")[0] ?? "Member", ""];

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return [parts[0], ""];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
}

export async function linkGoogleMember(identity: GoogleIdentity): Promise<LinkedMember | null> {
  const email = identity.email.trim().toLowerCase();
  if (!email) return null;

  const [firstName, lastName] = splitName(identity.name, email);

  // A single statement so two concurrent sign-ins from the same person cannot
  // create two rows. `google_sub` is only ever written, never cleared, and an
  // existing name is never overwritten by Google's.
  const rows = await execute<LinkedMember>(
    `insert into members (
       email, first_name, last_name, google_sub, image_url,
       email_verified_at, last_login_at
     )
     values ($1, $2, $3, $4, $5, now(), now())
     on conflict (email) do update
       set google_sub        = coalesce(members.google_sub, excluded.google_sub),
           image_url         = coalesce(excluded.image_url, members.image_url),
           email_verified_at = coalesce(members.email_verified_at, now()),
           last_login_at     = now(),
           updated_at        = now()
     returning ${LINKED_COLUMNS}`,
    [email, firstName, lastName, identity.sub, identity.picture ?? null],
  );

  const member = rows[0];
  if (!member) return null;

  // A blocked member may still sign in, but must not be handed a claim cookie.
  const blocked = await execute<{ is_blocked: boolean }>(
    `select is_blocked from members where id = $1`,
    [member.id],
  );
  if (blocked[0]?.is_blocked) return null;

  // Sign-in is the catch-up point for board dues: a board user added before
  // ever signing in had no members row to waive until now, and a season reset
  // clears the flags. A cheap indexed no-op for everyone else.
  await waiveBoardDues(member.email);

  return member;
}

export async function lookupMemberByEmail(email: string): Promise<LinkedMember | null> {
  const rows = await execute<LinkedMember>(
    `select ${LINKED_COLUMNS}
       from members
      where email = $1 and is_blocked = false`,
    [email.trim().toLowerCase()],
  );
  return rows[0] ?? null;
}

/**
 * The member behind a `csc_member` cookie, re-read rather than trusted: the
 * cookie lives 180 days, and blocking someone or bumping their token version
 * has to take effect on their next page load.
 */
export async function loadVerifiedMember(
  memberId: string,
  tokenVersion: number,
): Promise<Member | null> {
  const [member] = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.id, memberId),
        eq(members.tokenVersion, tokenVersion),
        eq(members.isBlocked, false),
        isNotNull(members.emailVerifiedAt),
      ),
    )
    .limit(1);

  return member ?? null;
}
