import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { SubmitButton } from "@/components/admin/submit-button";
import { Badge, Card, Field, Input, Notice, cn } from "@/components/ui";
import { getMemberSession } from "@/lib/member-session";
import { canUseRideSheet, getRideSheet, type RideView } from "@/lib/rides";
import { getTripBySlug } from "@/lib/trips";
import { loadVerifiedMember } from "@/lib/verification";
import {
  cancelRideAction,
  claimSeatAction,
  offerRideAction,
  releaseSeatAction,
} from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const trip = await getTripBySlug((await params).slug);
  return {
    title: trip ? `Rides - ${trip.title}` : "Trip not found",
    // Names and phone numbers. Nothing here belongs in an index.
    robots: { index: false, follow: false },
  };
}

const ERRORS: Record<string, string> = {
  full: "That car filled up before you got there. Pick another.",
  already_seated: "You already have a seat. Leave it before taking another.",
  already_driving: "You are driving - cancel your ride first if plans changed.",
  own_ride: "That is your own car.",
  ride_missing: "That ride was cancelled.",
  not_attendee: "The sheet is only for people confirmed on this trip.",
  invalid: "Check the phone number and the leaving time - both are needed.",
};

const riseDelay = (index: number): CSSProperties =>
  ({ "--rise-delay": `${Math.min(index, 8) * 45}ms` }) as CSSProperties;

/**
 * The ride sheet. Same audience as the roster page - roster finalized, viewer
 * actually going - because its whole job is handing out the names and phone
 * numbers of the people in the cars.
 */
export default async function TripRidesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const trip = await getTripBySlug(slug);
  if (!trip || trip.status === "draft") notFound();

  const session = await getMemberSession();
  const member = session
    ? await loadVerifiedMember(session.memberId, session.tokenVersion)
    : null;

  const entitled = member ? await canUseRideSheet(trip.id, member.id) : false;
  const { error } = await searchParams;

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <header className="mb-8">
        <Link
          href="/me"
          className="-my-2 inline-flex items-center gap-1.5 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <span aria-hidden="true">&larr;</span> My trips
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Rides</h1>
        <p className="mt-2 text-sm text-ink-muted">{trip.title}</p>
      </header>

      {!entitled || !member ? (
        <Notice title="The ride sheet opens once the roster is final">
          {member
            ? "Rides are organised between the people who are on this trip. If you are on it, this opens as soon as the board finalizes the roster."
            : "Sign in with the address you used to sign up, and make sure you are on this trip."}
        </Notice>
      ) : (
        <RideSheetView
          tripId={trip.id}
          slug={slug}
          memberId={member.id}
          error={error}
        />
      )}
    </main>
  );
}

async function RideSheetView({
  tripId,
  slug,
  memberId,
  error,
}: {
  tripId: string;
  slug: string;
  memberId: string;
  error?: string;
}) {
  const sheet = await getRideSheet(tripId, memberId);
  const { drivingRideId, seatRideId } = sheet.viewer;
  const hasRide = drivingRideId !== null || seatRideId !== null;

  return (
    <div className="space-y-6">
      {error && ERRORS[error] ? (
        <Notice tone="alert">{ERRORS[error]}</Notice>
      ) : null}

      {/* Drivers first: someone offering a car should not have to scroll past
          every existing one to find the form. Riders scan the list right below
          it either way. */}
      {!hasRide ? (
        <OfferForm slug={slug} />
      ) : (
        <p className="text-xs text-ink-faint">
          {drivingRideId
            ? "You are on the sheet as a driver. Cancel your ride if plans changed."
            : "You have a seat. Leave it first if you want to drive or switch cars."}
        </p>
      )}

      {sheet.rides.length === 0 ? (
        <Notice title="No cars yet">
          Nobody has offered a car for this trip. If you are driving, yours goes
          first.
        </Notice>
      ) : (
        <ul className="space-y-4">
          {sheet.rides.map((ride, index) => (
            <li key={ride.id} className="rise" style={riseDelay(index)}>
              <RideCard
                ride={ride}
                slug={slug}
                memberId={memberId}
                viewerHasRide={hasRide}
                isViewerSeat={ride.id === seatRideId}
                isViewerRide={ride.id === drivingRideId}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ink-faint">
        Phone numbers here are shared only with the people on this trip, so you
        can actually find each other in a parking lot at 6am. The club does not
        organise the driving.
      </p>
    </div>
  );
}

function RideCard({
  ride,
  slug,
  memberId,
  viewerHasRide,
  isViewerSeat,
  isViewerRide,
}: {
  ride: RideView;
  slug: string;
  memberId: string;
  viewerHasRide: boolean;
  isViewerSeat: boolean;
  isViewerRide: boolean;
}) {
  const free = ride.seatCapacity - ride.riders.length;

  return (
    <Card className={cn("p-5", (isViewerSeat || isViewerRide) && "border-accent/40")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-ink">
            {ride.driverName}
            {isViewerRide ? <span className="text-ink-muted"> (you)</span> : null}
          </p>
          <p className="tnum mt-0.5 text-sm text-ink-muted">{ride.phone}</p>
        </div>
        <Badge emphasis={free > 0 ? "strong" : "muted"}>
          {free > 0 ? `${free} seat${free === 1 ? "" : "s"} free` : "Full"}
        </Badge>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-faint">Leaving</dt>
          <dd className="mt-0.5 text-sm text-ink">{ride.departsNote}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-faint">Coming back</dt>
          <dd className="mt-0.5 text-sm text-ink">
            {ride.returnsNote ?? <span className="text-ink-faint">Ask the driver</span>}
          </dd>
        </div>
      </dl>

      {ride.riders.length > 0 ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs uppercase tracking-wide text-ink-faint">In this car</p>
          <ul className="mt-2 space-y-1.5">
            {ride.riders.map((rider) => (
              <li
                key={rider.memberId}
                className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm"
              >
                <span className="text-ink">
                  {rider.name}
                  {rider.memberId === memberId ? (
                    <span className="text-ink-muted"> (you)</span>
                  ) : null}
                </span>
                <span className="tnum text-ink-muted">{rider.phone}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 border-t border-border pt-4">
        {isViewerRide ? (
          <form action={cancelRideAction}>
            <input type="hidden" name="slug" value={slug} />
            <SubmitButton
              variant="danger"
              pendingLabel="Cancelling"
              confirm={
                ride.riders.length > 0
                  ? `Cancel your ride? ${ride.riders.length} ${ride.riders.length === 1 ? "person loses" : "people lose"} their seat, and nobody is notified for you.`
                  : "Take your car off the sheet?"
              }
            >
              Cancel my ride
            </SubmitButton>
          </form>
        ) : isViewerSeat ? (
          <form action={releaseSeatAction}>
            <input type="hidden" name="slug" value={slug} />
            <SubmitButton variant="secondary" pendingLabel="Leaving">
              Leave this ride
            </SubmitButton>
          </form>
        ) : viewerHasRide || free === 0 ? null : (
          /*
            The claim, spreadsheet-style: name is already known, so the only
            thing to type is the number the driver will actually call.
          */
          <form
            action={claimSeatAction}
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="rideId" value={ride.id} />
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-xs font-medium text-ink">
                Your phone number
              </span>
              <Input
                name="phone"
                type="tel"
                required
                placeholder="1 234 567 8910"
                className="max-w-56"
              />
            </label>
            <SubmitButton pendingLabel="Locking in">Lock in a seat</SubmitButton>
          </form>
        )}
      </div>
    </Card>
  );
}

function OfferForm({ slug }: { slug: string }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold tracking-tight">Offer your car</h2>

      <form action={offerRideAction} className="mt-5 space-y-4">
        <input type="hidden" name="slug" value={slug} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Leaving" hint="Time and meeting spot, like the sheet always had.">
            <Input name="departs" required maxLength={120} placeholder="Fri 6:00 AM, Regent lot" />
          </Field>
          <Field label="Coming back" hint="Leave it blank if you have not decided.">
            <Input name="returns" maxLength={120} placeholder="Sun after lunch" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Seats for riders" hint="Not counting you.">
            <select
              name="seats"
              required
              defaultValue="3"
              className="h-10 w-full rounded-md border border-border bg-paper px-3 text-sm text-ink focus:border-accent focus:outline-none"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Your phone number" hint="Shown to people on this trip.">
            <Input name="phone" type="tel" required placeholder="1 234 567 8910" />
          </Field>
        </div>

        <SubmitButton pendingLabel="Posting">Post my ride</SubmitButton>
      </form>
    </Card>
  );
}
