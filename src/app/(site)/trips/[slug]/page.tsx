import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge, Card, Detail, Notice, PageHeader, formatDenver, formatMoney } from "@/components/ui";
import { AvatarStack } from "@/components/avatar";
import { getAttendeeFaces, isTripAttendee } from "@/lib/trips/attendees";
import { currentMember } from "@/lib/auth/current-member";
import { getMemberSignup, getOccupancy, getTripBySlug } from "@/lib/trips/trips";
import { standingOf } from "@/lib/roster/standing";
import { issueChallenge } from "@/lib/claims/challenge";
import { StandingNotice } from "../../signup-status";
import { ClaimPanel } from "./claim-panel";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const trip = await getTripBySlug((await params).slug);
  return { title: trip ? `${trip.title} - CU Snowboarding` : "Trip not found" };
}

export default async function TripPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Two database depths: (trip, member), then one parallel batch.
  const [trip, member] = await Promise.all([getTripBySlug(slug), currentMember()]);

  if (!trip || trip.status === "draft") notFound();

  const released = trip.resultsReleasedAt !== null;
  const beforeOpen = trip.signupOpensAt.getTime() > Date.now();
  // Mirrors the claim panel's own clock check, for the page without one.
  const enterable =
    (trip.status === "scheduled" || trip.status === "open") &&
    !(trip.signupClosesAt && trip.signupClosesAt.getTime() <= Date.now());

  const [occupancy, existingSignup, attendance, entitled, challenge] = await Promise.all([
    getOccupancy(trip.id, trip.capacity),
    member ? getMemberSignup(trip.id, member.id) : null,
    trip.rosterFinalizedAt ? getAttendeeFaces(trip.id, 3) : null,
    trip.rosterFinalizedAt && member ? isTripAttendee(trip.id, member.id) : false,
    // Issued at render so that at 8:00:00 the client already holds it and
    // entering costs no extra round trip. An HMAC sign, so issuing it even
    // when an existing signup will win the render below costs nothing.
    member ? issueChallenge(trip.id, member.id, trip.signupPhrase) : null,
  ]);

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <PageHeader back="/" backLabel="Home" title={trip.title}>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge>
            {beforeOpen
              ? `${trip.capacity} spots`
              : occupancy.taken > trip.capacity
                ? `${occupancy.taken} spots taken`
                : `${occupancy.taken} of ${trip.capacity} spots taken`}
          </Badge>
          {occupancy.waitlisted > 0 ? (
            <Badge emphasis="muted">{occupancy.waitlisted} waitlisted</Badge>
          ) : null}
        </div>
      </PageHeader>

      {/* Where the member stands, or the way in, comes before the details:
          on drop night the phrase must not sit below the fold on a phone. */}
      {existingSignup ? (
        <StandingNotice standing={standingOf(existingSignup)} signup={existingSignup} />
      ) : member && challenge ? (
        <ClaimPanel
          tripId={trip.id}
          signupOpensAtMs={trip.signupOpensAt.getTime()}
          signupClosesAtMs={trip.signupClosesAt?.getTime() ?? null}
          // A scheduled trip opens itself at signup_opens_at; the countdown
          // decides the rest, and the claim re-checks the clock server-side.
          isOpenStatus={trip.status === "scheduled" || trip.status === "open"}
          challenge={challenge}
          enteringAs={`${member.firstName} ${member.lastName} (${member.email})`}
        />
      ) : !enterable ? (
        <Notice title="Signups are closed" />
      ) : (
        // Signed in, but without the claim cookie the entry cannot be made.
        <Card>
          <h2 className="text-lg font-semibold">Set up this browser to enter</h2>
          <p className="mt-1 mb-5 text-sm text-ink-muted">
            One click, and best done now rather than when signups open.
          </p>
          <a
            href={`/api/member/arm?next=/trips/${trip.slug}`}
            className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Set up this browser
          </a>
        </Card>
      )}

      <Card className="mt-6">
        <dl className="grid grid-cols-2 gap-4">
          <Detail label="Departs">{formatDenver(trip.departAt)}</Detail>
          {trip.returnAt ? <Detail label="Returns">{formatDenver(trip.returnAt)}</Detail> : null}
          {trip.resort ? <Detail label="Resort">{trip.resort}</Detail> : null}
          <Detail label="Cost">
            {trip.priceCents === 0 ? (
              <span className="font-medium">Free</span>
            ) : (
              <>
                <span className="font-medium">{formatMoney(trip.priceCents)}</span>, paid on Fusion
              </>
            )}
          </Detail>
          {beforeOpen ? (
            <Detail label="Signups open">{formatDenver(trip.signupOpensAt)}</Detail>
          ) : null}
          {trip.priceCents === 0 ? (
            <Detail label="Payment">No payment required</Detail>
          ) : released ? null : (
            <Detail label="Payment">
              Due within {trip.paymentWindowHours} hours of the roster release
            </Detail>
          )}
        </dl>

        {trip.description ? (
          <p className="mt-5 whitespace-pre-line border-t border-border pt-5 text-sm text-ink-muted">
            {trip.description}
          </p>
        ) : null}
      </Card>

      {attendance && attendance.total > 0 ? (
        <Card className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <AvatarStack people={attendance.faces} />
              <p className="text-sm text-ink-muted">{attendance.total} confirmed</p>
            </div>
            {/* The full roster is for riders who are themselves paid. */}
            {entitled ? (
              <Link
                href={`/trips/${trip.slug}/roster`}
                className="text-sm font-medium text-accent underline underline-offset-4"
              >
                See the roster
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}
    </main>
  );
}
