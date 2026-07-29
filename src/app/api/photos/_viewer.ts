import { auth } from "@/auth";
import { can, loadBoardIdentity } from "@/lib/authz";
import { lookupMemberByEmail } from "@/lib/member-account";
import { getMemberSession } from "@/lib/member-session";
import { loadVerifiedMember } from "@/lib/verification";
import { ANONYMOUS_VIEWER, type PhotoViewer } from "@/lib/photos";

/**
 * Turns whatever credentials a request happens to carry into the one identity
 * the photo rules care about.
 *
 * This lives beside the routes rather than in `lib/photos.ts` deliberately:
 * reading cookies and auth sessions is request-context work, and keeping it out
 * of the domain module is what lets the access rules be tested directly against
 * the database with no HTTP in the way.
 *
 * There are two ways to be a member here - the emailed-code cookie and a Google
 * sign-in - and someone may hold a board session as well. All three are checked
 * against the database rather than trusted from a token, because a token stays
 * valid for hours after someone is blocked or leaves the board.
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
    // Board sign-in is optional infrastructure. A misconfigured or absent
    // NextAuth setup must leave the member path working, not 500 the gallery.
    email = null;
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
