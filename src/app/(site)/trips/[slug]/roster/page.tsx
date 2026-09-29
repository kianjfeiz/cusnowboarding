import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AttendeeList } from "@/components/avatar";
import { Card, DAY_ONLY, Notice, PageHeader, SectionHeading, formatDenver } from "@/components/ui";
import { isTripAttendee, listAttendees } from "@/lib/trips/attendees";
import { currentMember } from "@/lib/auth/current-member";
import { getTripBySlug } from "@/lib/trips/trips";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const trip = await getTripBySlug((await params).slug);
  return {
    title: trip ? `Roster - ${trip.title}` : "Trip not found",
    // Names of members on a private club trip: never for a search index.
    robots: { index: false, follow: false },
  };
}

/**
 * Who is on this trip, for the people who are on it. Two gates: the roster must
 * be finalized, and the viewer must themselves be `paid` on the trip.
 */
export default async function TripRosterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const trip = await getTripBySlug(slug);
  if (!trip || trip.status === "draft") notFound();

  const member = await currentMember();
  const entitled =
    trip.rosterFinalizedAt !== null &&
    member !== null &&
    (await isTripAttendee(trip.id, member.id));

  const attendees = entitled ? await listAttendees(trip.id) : [];
  // Board seats are not spots, so they are listed apart and not counted.
  const riders = attendees.filter((person) => !person.boardSeat);
  const board = attendees.filter((person) => person.boardSeat);

  const departs = formatDenver(trip.departAt, DAY_ONLY);
  const returns = trip.returnAt ? formatDenver(trip.returnAt, DAY_ONLY) : departs;

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <PageHeader back="/me" backLabel="My trips" title="Roster">
        <p className="mt-2 text-sm text-ink-muted">
          {trip.title}
          {trip.resort ? ` · ${trip.resort}` : ""} · {departs}
          {returns !== departs ? ` - ${returns}` : ""}
        </p>
      </PageHeader>

      {!entitled ? (
        trip.rosterFinalizedAt === null ? (
          <Notice title="The roster is not out yet">
            The board releases it soon after signups close.
          </Notice>
        ) : (
          <Notice title="Shown once you are marked paid">
            The roster is for riders who have paid. Being marked paid can lag paying
            by a day.
          </Notice>
        )
      ) : (
        <Card>
          <SectionHeading className="mb-4">Riders ({riders.length})</SectionHeading>
          <AttendeeList people={riders.map((person) => ({ ...person, detail: person.email }))} />
          {board.length > 0 ? (
            <>
              <SectionHeading className="mb-3 mt-6">Board ({board.length})</SectionHeading>
              <AttendeeList people={board.map((person) => ({ ...person, detail: person.email }))} />
            </>
          ) : null}
        </Card>
      )}
    </main>
  );
}
