import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge, Card, Notice, formatDenver, formatMoney } from "@/components/ui";
import { AvatarStack, Avatar } from "@/components/avatar";
import { SiteHeader } from "@/components/site-header";
import { getAttendeeFaces, isTripAttendee, listAttendees } from "@/lib/attendees";
import { getMemberSession } from "@/lib/member-session";
import { loadVerifiedMember } from "@/lib/verification";
import { getMemberSignup, getOccupancy, getTripBySlug } from "@/lib/trips";
import { issueChallenge } from "@/lib/challenge";
import { clubPaymentUrl } from "@/lib/payments";
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
  const trip = await getTripBySlug(slug);

  if (!trip || trip.status === "draft") notFound();

  const session = await getMemberSession();
  const member = session
    ? await loadVerifiedMember(session.memberId, session.tokenVersion)
    : null;

  const paymentLink = trip.paymentUrl || clubPaymentUrl();

  const [occupancy, existingSignup] = await Promise.all([
    getOccupancy(trip.id, trip.capacity),
    member ? getMemberSignup(trip.id, member.id) : Promise.resolve(null),
  ]);

  const attendance = trip.rosterFinalizedAt ? await getAttendeeFaces(trip.id, 3) : null;
  const attendees =
    trip.rosterFinalizedAt && member && (await isTripAttendee(trip.id, member.id))
      ? await listAttendees(trip.id)
      : null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-5 py-12">
      <header className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <span aria-hidden="true">&larr;</span> All trips
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{trip.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge emphasis="strong">{formatMoney(trip.priceCents)}</Badge>
          <Badge>
            {occupancy.taken} of {trip.capacity} spots taken
          </Badge>
          {occupancy.waitlisted > 0 ? (
            <Badge emphasis="muted">{occupancy.waitlisted} waitlisted</Badge>
          ) : null}
        </div>
      </header>

      <Card className="mb-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-faint">Departs</dt>
            <dd className="mt-1 text-sm text-ink">{formatDenver(trip.departAt)}</dd>
          </div>
          {trip.returnAt ? (
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-faint">Returns</dt>
              <dd className="mt-1 text-sm text-ink">{formatDenver(trip.returnAt)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-faint">Signups open</dt>
            <dd className="mt-1 text-sm text-ink">{formatDenver(trip.signupOpensAt)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-faint">Cost</dt>
            <dd className="mt-1 text-sm font-medium text-ink">
              {formatMoney(trip.priceCents)} per person
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-faint">Payment window</dt>
            <dd className="mt-1 text-sm text-ink">
              {trip.paymentWindowHours} hours after results go out
            </dd>
          </div>
        </dl>

        {trip.description ? (
          <p className="mt-5 border-t border-border pt-5 text-sm text-ink-muted">
            {trip.description}
          </p>
        ) : null}

        {/*
          Shown to everyone, not just people who got a spot. The cost and where
          the money goes are the two things members ask before they enter, and
          burying the link behind winning a spot means the board answers it by
          hand every time.
        */}
        {paymentLink ? (
          <p className="mt-5 border-t border-border pt-5 text-sm text-ink-muted">
            Payment is handled on the club portal.{" "}
            <a
              href={paymentLink}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent underline underline-offset-4"
            >
              Open the payment page
            </a>
            . Pay only once you have a spot and a deadline.
          </p>
        ) : null}
      </Card>

      {existingSignup ? (
        <ExistingSignup signup={existingSignup} />
      ) : (
        <ClaimPanel
          tripId={trip.id}
          signupOpensAtMs={trip.signupOpensAt.getTime()}
          signupClosesAtMs={trip.signupClosesAt?.getTime() ?? null}
          armed={member !== null}
          priceCents={trip.priceCents}
          isOpenStatus={trip.status === "open"}
          // Issued at render so that at 8:00:00 the client already holds it and
          // entering costs no extra round trip.
          challenge={member ? await issueChallenge(trip.id, member.id) : null}
        />
      )}

      {!member && !existingSignup ? (
        <Card className="mt-6">
          <h2 className="text-lg font-semibold">Get ready for this drop</h2>
          <p className="mt-1 mb-5 text-sm text-ink-muted">
            You are signed in, but this browser is not armed for one-click
            claiming yet. Arm it now rather than at signup time - the button will
            not work without it.
          </p>
          <a
            href={`/api/member/arm?next=/trips/${trip.slug}`}
            className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Arm this browser
          </a>
        </Card>
      ) : null}

      {member && !existingSignup ? (
        <p className="mt-6 text-center text-xs text-ink-faint">
          Verified as {member.firstName} {member.lastName} ({member.email})
        </p>
      ) : null}

      {attendees ? (
        <Card className="mt-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              On this trip ({attendees.length})
            </h2>
            <Link
              href={`/trips/${trip.slug}/photos`}
              className="text-sm text-accent underline underline-offset-4"
            >
              Photos
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {attendees.map((person) => (
              <li key={person.memberId} className="flex items-center gap-3">
                <Avatar src={person.imageUrl} name={person.name} size={32} />
                <div className="min-w-0">
                  <p className="truncate text-sm">{person.name}</p>
                  <p className="tnum text-xs text-ink-faint">Spot {person.spotNumber}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : attendance && attendance.total > 0 ? (
        <Card className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <AvatarStack people={attendance.faces} total={attendance.total} />
            <p className="text-xs text-ink-faint">
              The full list and photos are visible to people who went.
            </p>
          </div>
        </Card>
      ) : null}
      </main>
    </>
  );
}

function ExistingSignup({
  signup,
}: {
  signup: NonNullable<Awaited<ReturnType<typeof getMemberSignup>>>;
}) {
  /**
   * Before the board publishes outcomes, an entrant learns only that their
   * entry landed. Same message whether they took spot 3 or missed by twenty -
   * anything else and reloading this page becomes the scoreboard the drop
   * design is trying to avoid.
   */
  if (!signup.resultsReleased) {
    return (
      <Notice tone="accent" title="Entry received">
        Results usually go out within about twenty minutes of signups opening.
        You will get an email either way.
      </Notice>
    );
  }

  if (signup.status === "waitlisted") {
    return (
      <Notice title="You are on the waitlist">
        The trip filled up. Spots do open when people drop or holds go unpaid,
        and the coordinators pull from the waitlist when they do. You will get an
        email if you get one.
      </Notice>
    );
  }

  if (signup.status === "paid") {
    return (
      <Notice tone="accent" title={`Confirmed - spot ${signup.spotNumber}`}>
        You are paid and on the trip. Nothing more to do.
      </Notice>
    );
  }

  const lapsed =
    signup.paymentDeadlineAt !== null && signup.paymentDeadlineAt.getTime() < Date.now();

  if (lapsed) {
    return (
      <Notice tone="alert" title="Your hold has lapsed">
        The payment deadline passed, so your spot has been released.
      </Notice>
    );
  }

  return (
    <Notice tone="accent" title={`You are in - spot ${signup.spotNumber}`}>
      <p>
        Your spot is held until{" "}
        {signup.paymentDeadlineAt ? formatDenver(signup.paymentDeadlineAt) : "the deadline"}.
        After that it is released to the waitlist.
      </p>
      <p className="mt-3">
        <a
          className="font-medium text-accent underline underline-offset-4"
          href={`/pay/${signup.payToken}`}
        >
          Pay {formatMoney(signup.amountCents)} now
        </a>
      </p>
    </Notice>
  );
}
