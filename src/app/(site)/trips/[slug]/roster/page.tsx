import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Avatar } from "@/components/avatar";
import { Card, Notice, formatDenver } from "@/components/ui";
import { isTripAttendee, listAttendees } from "@/lib/attendees";
import { getMemberSession } from "@/lib/member-session";
import { getTripBySlug } from "@/lib/trips";
import { loadVerifiedMember } from "@/lib/verification";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const trip = await getTripBySlug((await params).slug);
  return {
    title: trip ? `Who is going - ${trip.title}` : "Trip not found",
    // The list names members of a private club trip. Whatever the access rules
    // already prevent, none of it belongs in a search index.
    robots: { index: false, follow: false },
  };
}

/**
 * Who is on this trip, for the people who are on it.
 *
 * Two gates, both the same ones the trip page has always applied to this list:
 *
 * `roster_finalized_at` must be set. Before the board finalises, holds are
 * still lapsing and the waitlist is still moving, so publishing the list would
 * both churn and reveal who is about to lose their spot for non-payment.
 *
 * And the viewer must have actually gone - `signups.status = 'paid'`. A board
 * seat is deliberately not enough here; the board reads rosters in /admin,
 * which is audited. This page widens nothing that the trip page did not already
 * show, it just gives it somewhere to live that is not buried under the signup
 * mechanics a confirmed rider has no use for.
 */
export default async function TripRosterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const trip = await getTripBySlug(slug);
  if (!trip || trip.status === "draft") notFound();

  const session = await getMemberSession();
  const member = session
    ? await loadVerifiedMember(session.memberId, session.tokenVersion)
    : null;

  const entitled =
    trip.rosterFinalizedAt !== null &&
    member !== null &&
    (await isTripAttendee(trip.id, member.id));

  const attendees = entitled ? await listAttendees(trip.id) : [];

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <header className="mb-8">
        {/* Back to My trips rather than the trip page: this is only reachable
            from there, and the trip page is the browsing view. */}
        <Link
          href="/me"
          className="-my-2 inline-flex items-center gap-1.5 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <span aria-hidden="true">&larr;</span> My trips
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Who is going</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {trip.title}
          {trip.resort ? ` - ${trip.resort}` : ""}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          {formatDenver(trip.departAt)}
          {trip.returnAt ? ` - ${formatDenver(trip.returnAt)}` : ""}
        </p>
      </header>

      {!entitled ? (
        <Notice title="The list is not out yet">
          {trip.rosterFinalizedAt === null
            ? "Results for this trip are not out yet. Once they are, everyone who is on the trip can see who else is coming."
            : "This list is shared only with the people who are on this trip."}
        </Notice>
      ) : (
        <Card>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-faint">
            On this trip ({attendees.length})
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {attendees.map((person) => (
              <li key={person.memberId} className="flex items-center gap-3">
                <Avatar src={person.imageUrl} name={person.name} size={32} />
                <div className="min-w-0">
                  <p className="truncate text-sm">{person.name}</p>
                  <p className="truncate text-xs text-ink-faint">{person.email}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
