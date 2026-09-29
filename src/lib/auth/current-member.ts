import { loadVerifiedMember } from "@/lib/auth/member-account";
import { getMemberSession } from "@/lib/auth/member-session";

/**
 * The member behind this request's `csc_member` cookie, re-read from the
 * database so a block or a token-version bump takes effect on the next load.
 * Never call this from the claim route - that path verifies the cookie
 * in-process and must not gain a database read.
 */
export async function currentMember() {
  const session = await getMemberSession();
  return session ? loadVerifiedMember(session.memberId, session.tokenVersion) : null;
}
