import Link from "next/link";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { auth, signIn } from "@/auth";
import { Badge, Card, Notice, formatDenver, formatMoney } from "@/components/ui";
import { PhotoStrip } from "@/components/photos/photo-strip";
import { resolvePhotoViewer } from "@/app/api/photos/_viewer";
import { getTripPhotoPreview, type TripPhotoPreview } from "@/lib/photos";
import { listMemberTrips, type MemberTrip } from "@/lib/attendees";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My trips - CU Snowboarding" };

/** Rows past this point arrive together; only the top of a list is choreography. */
const STAGGER_LIMIT = 8;

const riseDelay = (index: number): CSSProperties =>
  ({ "--rise-delay": `${Math.min(index, STAGGER_LIMIT) * 45}ms` }) as CSSProperties;

/** Enough to read as "there are pictures in here" without becoming the gallery. */
const STRIP_PHOTOS = 4;

/**
 * When the trip runs, as one line.
 *
 * The time of day is dropped on purpose. On this page the question is which
 * weekend it is, and a departure to the minute is the trip page's job - it is
 * also the thing most likely to move between now and then.
 */
function tripDates(trip: MemberTrip): string {
  const day = { month: "short", day: "numeric" } as const;
  const departs = formatDenver(trip.departAt, {
    ...day,
    hour: undefined,
    minute: undefined,
    timeZoneName: undefined,
  });
  if (!trip.returnAt) return departs;

  const returns = formatDenver(trip.returnAt, {
    ...day,
    hour: undefined,
    minute: undefined,
    timeZoneName: undefined,
  });
  return departs === returns ? departs : `${departs} - ${returns}`;
}

/** The card's actions. Buttons rather than links, because the card is not one. */
function CardAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center rounded-md border border-border-strong px-3 text-sm font-medium text-ink transition-colors hover:bg-surface"
    >
      {children}
    </Link>
  );
}

export default async function MyTripsPage() {
  const session = await auth();
  const memberId = session?.user?.memberId;

  if (!memberId) {
    return (
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
    );
  }

  // The viewer is resolved from cookies and the session, not from the trips,
  // so the two reads run side by side.
  const [trips, viewer] = await Promise.all([
    listMemberTrips(memberId),
    resolvePhotoViewer(),
  ]);
  const now = Date.now();

  // "Past" is decided by the return date rather than by status: a trip you paid
  // for is still upcoming until it actually happens.
  const endOf = (trip: MemberTrip) =>
    new Date(trip.returnAt ?? trip.departAt).getTime();

  const upcoming = trips.filter((t) => endOf(t) >= now);
  const past = trips.filter((t) => endOf(t) < now);

  /*
    One preview per finalised trip. `getTripPhotoPreview` runs the same
    entitlement check the gallery does and returns nothing when it fails, so a
    trip the member was waitlisted on simply has no row - the decision is not
    re-derived from `trip.status` here, where it could drift.
  */
  const previews = new Map(
    await Promise.all(
      trips
        .filter((t) => t.rosterFinalizedAt !== null)
        .map(
          async (t) =>
            [t.tripId, await getTripPhotoPreview(t.tripId, viewer, STRIP_PHOTOS)] as const,
        ),
    ),
  );

  return (
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
            {upcoming.map((trip, index) => (
              <div key={trip.tripId} className="rise" style={riseDelay(index)}>
                <TripCard trip={trip} preview={previews.get(trip.tripId)} />
              </div>
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
            {past.map((trip, index) => (
              <div
                key={trip.tripId}
                className="rise"
                style={riseDelay(upcoming.length + index)}
              >
                <TripCard trip={trip} preview={previews.get(trip.tripId)} past />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function TripCard({
  trip,
  preview,
  past = false,
}: {
  trip: MemberTrip;
  /** Null when the photo rules would not let this viewer in. */
  preview?: TripPhotoPreview | null;
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
          {/* Not a link. The card is a summary with its own two actions; making
              the whole thing navigate as well gave the same card two
              destinations depending on where you tapped. */}
          <p className="font-medium text-ink">{trip.title}</p>
          <p className="mt-1 text-sm text-ink-muted">
            {tripDates(trip)}
            {trip.resort ? ` · ${trip.resort}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!trip.resultsReleased ? (
            // Same badge whatever the outcome, until the board publishes.
            <Badge emphasis="muted">Entry received</Badge>
          ) : trip.status === "paid" ? (
            // The spot number is an occupancy detail the board needs, not
            // something a member has to carry around. Being on the trip is the
            // whole message.
            <Badge emphasis="strong">Confirmed</Badge>
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

      {/*
        Only for people the photo rules would actually let in. The row used to
        render for anyone on a finalised trip, which offered a waitlisted member
        an "Add photos" link that the gallery then refused.
      */}
      {trip.rosterFinalizedAt && preview ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <PhotoStrip
            photos={preview.photos}
            total={preview.total}
            tripTitle={trip.title}
          />
          <div className="flex flex-wrap items-center gap-2">
            {/* The strip beside it already says how many there are, so this
                stays a verb. With none yet, it says what to do about that. */}
            <CardAction href={`/trips/${trip.slug}/photos`}>
              {preview.total > 0 ? "Photos" : "Add photos"}
            </CardAction>
            <CardAction href={`/trips/${trip.slug}/roster`}>Roster</CardAction>
          </div>
        </div>
      ) : null}
    </div>
  );
}
