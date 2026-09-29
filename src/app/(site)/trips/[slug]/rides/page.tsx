import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SubmitButton } from "@/components/admin/submit-button";
import { Badge, Card, Detail, Field, Input, Notice, PageHeader, cn } from "@/components/ui";
import { currentMember } from "@/lib/auth/current-member";
import { canUseRideSheet, getRideSheet, type RideSheet, type RideView } from "@/lib/trips/rides";
import { getTripBySlug } from "@/lib/trips/trips";
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

/**
 * The ride sheet hands out names and phone numbers, so it has the roster
 * page's audience: roster finalized, and the viewer paid on the trip.
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

  const member = await currentMember();
  const sheet =
    member && (await canUseRideSheet(trip.id, member.id))
      ? await getRideSheet(trip.id, member.id)
      : null;
  const { error } = await searchParams;

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <PageHeader back="/me" backLabel="My trips" title="Rides">
        <p className="mt-2 text-sm text-ink-muted">{trip.title}</p>
      </PageHeader>

      {!sheet || !member ? (
        trip.rosterFinalizedAt === null ? (
          <Notice title="Rides open after the roster is released" />
        ) : (
          <Notice title="Rides open once you are marked paid">
            Being marked paid can lag paying by a day.
          </Notice>
        )
      ) : (
        <div className="space-y-6">
          {error && ERRORS[error] ? <Notice tone="alert">{ERRORS[error]}</Notice> : null}

          {/* Above the list: a driver should not scroll past every car to offer one.
              Anyone already in a car sees why the form is gone on that car's card. */}
          {sheet.viewer.drivingRideId === null && sheet.viewer.seatRideId === null ? (
            <OfferForm slug={slug} />
          ) : null}

          {sheet.rides.length === 0 ? (
            <Notice title="No cars yet" />
          ) : (
            <ul className="space-y-4">
              {sheet.rides.map((ride) => (
                <li key={ride.id}>
                  <RideCard ride={ride} slug={slug} memberId={member.id} viewer={sheet.viewer} />
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-ink-faint">
            Phone numbers here are shared only with riders on this trip.
          </p>
        </div>
      )}
    </main>
  );
}

function RideCard({
  ride,
  slug,
  memberId,
  viewer,
}: {
  ride: RideView;
  slug: string;
  memberId: string;
  viewer: RideSheet["viewer"];
}) {
  const free = ride.seatCapacity - ride.riders.length;
  const isViewerRide = ride.id === viewer.drivingRideId;
  const isViewerSeat = ride.id === viewer.seatRideId;
  const viewerHasRide = viewer.drivingRideId !== null || viewer.seatRideId !== null;

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

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <Detail label="Leaving">{ride.departsNote}</Detail>
        <Detail label="Coming back">
          {ride.returnsNote ?? <span className="text-ink-faint">Ask the driver</span>}
        </Detail>
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
          <form action={claimSeatAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="rideId" value={ride.id} />
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-xs font-medium text-ink">Your phone number</span>
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
          <Field label="Leaving" hint="Time and meeting spot.">
            <Input name="departs" required maxLength={120} placeholder="Fri 6:00 AM, Regent lot" />
          </Field>
          <Field label="Coming back" hint="Optional.">
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
          <Field label="Your phone number">
            <Input name="phone" type="tel" required placeholder="1 234 567 8910" />
          </Field>
        </div>

        <SubmitButton pendingLabel="Posting">Post my ride</SubmitButton>
      </form>
    </Card>
  );
}
