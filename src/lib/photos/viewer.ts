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
  // The cookie member and the session email are independent; resolve both at once.
  const [cookieMember, email] = await Promise.all([
    getMemberSession().then((cookieSession) =>
      cookieSession
        ? loadVerifiedMember(cookieSession.memberId, cookieSession.tokenVersion)
        : null,
    ),
    auth()
      .then((session) => session?.user?.email ?? null)
      // A misconfigured NextAuth setup must leave the cookie path working, not
      // 500 the gallery.
      .catch(() => null),
  ]);

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
