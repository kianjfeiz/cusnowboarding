import Link from "next/link";
import type { Metadata } from "next";
import { auth, signIn } from "@/auth";
import { Badge, Card, Notice, formatDenver, formatMoney } from "@/components/ui";
import { AvatarStack } from "@/components/avatar";
import { SiteHeader } from "@/components/site-header";
import { getAttendeeFaces } from "@/lib/attendees";
import { listMemberTrips, type MemberTrip } from "@/lib/attendees";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My trips - CU Snowboarding" };

export default async function MyTripsPage() {
  const session = await auth();
  const memberId = session?.user?.memberId;

  if (!memberId) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-4xl px-5 py-12">
          <h1 className="text-2xl font-semibold tracking-tight">My trips</h1>
          <Card className="mt-6">
            <p className="text-sm text-ink-muted">
              Sign in to see the trips you are on, pay for a spot, and get to trip
              photos.
            </p>
            <form
              className="mt-4"
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/api/member/arm?next=/me" });
              }}
            >
              <button
                type="submit"
                className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
              >
                Sign in with Google
              </button>
            </form>
          </Card>
        </main>
      </>
    );
  }

  const trips = await listMemberTrips(memberId);
  const now = Date.now();

  // "Past" is decided by the return date rather than by status: a trip you paid
  // for is still upcoming until it actually happens.
  const endOf = (trip: MemberTrip) =>
    new Date(trip.returnAt ?? trip.departAt).getTime();

  const upcoming = trips.filter((t) => endOf(t) >= now);
  const past = trips.filter((t) => endOf(t) < now);

  const attendance = new Map(
    await Promise.all(
      trips
        .filter((t) => t.rosterFinalizedAt !== null)
        .map(
          async (t) => [t.tripId, await getAttendeeFaces(t.tripId)] as const,
        ),
    ),
  );

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">My trips</h1>

        {trips.length === 0 ? (
          <Card className="mt-6">
            <p className="text-sm text-ink-muted">
              You are not on any trips yet.{" "}
              <Link href="/" className="text-accent underline underline-offset-4">
                See what is coming up
              </Link>
              .
            </p>
          </Card>
        ) : null}

        {upcoming.length > 0 ? (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
              Upcoming
            </h2>
            <div className="space-y-3">
              {upcoming.map((trip) => (
                <TripCard
                  key={trip.tripId}
                  trip={trip}
                  attendance={attendance.get(trip.tripId)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {past.length > 0 ? (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
              Past trips
            </h2>
            <div className="space-y-3">
              {past.map((trip) => (
                <TripCard
                  key={trip.tripId}
                  trip={trip}
                  attendance={attendance.get(trip.tripId)}
                  past
                />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}

function TripCard({
  trip,
  attendance,
  past = false,
}: {
  trip: MemberTrip;
  attendance?: { total: number; faces: { id: string; name: string; imageUrl: string | null }[] };
  past?: boolean;
}) {
  const owes = trip.status === "held";
  const lapsed =
    owes &&
    trip.paymentDeadlineAt !== null &&
    new Date(trip.paymentDeadlineAt).getTime() < Date.now();

  return (
    <div className="rounded-lg border border-border bg-paper p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={`/trips/${trip.slug}`}
            className="font-medium hover:underline"
          >
            {trip.title}
          </Link>
          <p className="mt-1 text-sm text-ink-muted">
            {formatDenver(trip.departAt)}
            {trip.resort ? ` · ${trip.resort}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!trip.resultsReleased ? (
            // Same badge whatever the outcome, until the board publishes.
            <Badge emphasis="muted">Entry received</Badge>
          ) : trip.status === "paid" ? (
            <Badge emphasis="strong">Spot {trip.spotNumber}</Badge>
          ) : trip.status === "waitlisted" ? (
            // No number: the board picks from the waitlist rather than working
            // strictly down it, so a position would promise a queue that is not
            // how the decision actually gets made.
            <Badge emphasis="muted">Waitlisted</Badge>
          ) : lapsed ? (
            <Badge>Hold lapsed</Badge>
          ) : (
            <Badge>Payment due</Badge>
          )}
        </div>
      </div>

      {owes && !past && trip.resultsReleased ? (
        <div className="mt-4">
          {lapsed ? (
            <Notice tone="alert" title="Your hold lapsed">
              The payment deadline passed, so the spot went back to the waitlist.
            </Notice>
          ) : (
            <Notice tone="accent">
              <span>
                {formatMoney(trip.amountCents)} due by{" "}
                {trip.paymentDeadlineAt ? formatDenver(trip.paymentDeadlineAt) : "the deadline"}.{" "}
              </span>
              <Link
                href={`/pay/${trip.payToken}`}
                className="font-medium text-accent underline underline-offset-4"
              >
                Pay now
              </Link>
            </Notice>
          )}
        </div>
      ) : null}

      {trip.rosterFinalizedAt && attendance && attendance.total > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <AvatarStack people={attendance.faces} total={attendance.total} />
          <Link
            href={`/trips/${trip.slug}/photos`}
            className="text-sm text-accent underline underline-offset-4"
          >
            {trip.photoCount > 0
              ? `${trip.photoCount} photo${trip.photoCount === 1 ? "" : "s"}`
              : "Add photos"}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
