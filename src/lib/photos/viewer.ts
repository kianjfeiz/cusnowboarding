import { auth } from "@/auth";
import { can, loadBoardIdentity } from "@/lib/auth/authz";
import { loadVerifiedMember, lookupMemberByEmail } from "@/lib/auth/member-account";
import { getMemberSession } from "@/lib/auth/member-session";
import { ANONYMOUS_VIEWER, type PhotoViewer } from "@/lib/photos/photos";

/**
 * Turns whatever credentials a request carries into the one identity the photo
 * rules care about. Kept out of `photos.ts` so the access rules can be tested
 * against the database with no HTTP in the way.
 *
 * Every credential is checked against the database rather than trusted from a
 * token, because a token stays valid for hours after someone is blocked or
 * leaves the board.
 */
export async function resolvePhotoViewer(): Promise<PhotoViewer> {
  const cookieSession = await getMemberSession();
  const cookieMember = cookieSession
    ? await loadVerifiedMember(cookieSession.memberId, cookieSession.tokenVersion)
    : null;

  let email: string | null = null;
  try {
    const session = await auth();
    email = session?.user?.email ?? null;
  } catch {
    // A misconfigured NextAuth setup must leave the cookie path working, not
    // 500 the gallery.
  }

  if (!email) {
    return cookieMember
      ? { memberId: cookieMember.id, boardUserId: null, isModerator: false }
      : ANONYMOUS_VIEWER;
  }

  const [board, linked] = await Promise.all([
    loadBoardIdentity(email),
    cookieMember ? Promise.resolve(null) : lookupMemberByEmail(email),
  ]);

  const isModerator = can(board, "viewRosters");

  return {
    memberId: cookieMember?.id ?? linked?.id ?? null,
    boardUserId: isModerator ? (board?.boardUserId ?? null) : null,
    isModerator,
  };
}
