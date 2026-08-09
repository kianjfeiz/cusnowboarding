import { execute } from "@/lib/db";
import { waiveBoardDues } from "@/lib/dues";

/**
 * Links a Google identity to a `members` row.
 *
 * Two things worth stating, because both are easy to get wrong later:
 *
 * 1. Signing in with Google IS verification. Google has already proven control
 *    of the address, so the member is marked verified without an emailed code.
 *    The emailed-code path stays for people who would rather not use Google.
 *
 * 2. Board members are members. Someone on the board still goes on trips, still
 *    appears on rosters, and still uploads photos. Board status is an extra
 *    attribute of a person, not a separate kind of account, so every Google
 *    sign-in resolves to a member row regardless.
 *
 * Matching is by `google_sub` first and email second: the subject id is stable
 * if someone changes their address, and the email match is what adopts the row
 * an existing member already built up through the code flow.
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

  /**
   * A single statement so two concurrent sign-ins from the same person cannot
   * create two rows. The email column is citext with a unique index, which is
   * what the conflict target resolves against.
   *
   * `google_sub` is only ever written, never cleared, and the name is refreshed
   * only when the existing row has nothing better - a member who corrected
   * their name on a signup form should not have Google overwrite it every login.
   */
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
     returning id, token_version as "tokenVersion", email::text as email,
               first_name as "firstName", last_name as "lastName",
               name_confirmed_at as "nameConfirmedAt"`,
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

  // Board members do not pay dues, and sign-in is the catch-up point: a board
  // user added before ever signing in had no members row to waive until now.
  // Also what re-comps the board after a season reset clears the flags. A cheap
  // indexed no-op for everyone else, and this runs at sign-in, not per request.
  await waiveBoardDues(member.email);

  return member;
}

export async function lookupMemberByEmail(email: string): Promise<LinkedMember | null> {
  const rows = await execute<LinkedMember>(
    `select id, token_version as "tokenVersion", email::text as email,
            first_name as "firstName", last_name as "lastName",
            name_confirmed_at as "nameConfirmedAt"
       from members
      where email = $1 and is_blocked = false`,
    [email.trim().toLowerCase()],
  );
  return rows[0] ?? null;
}
