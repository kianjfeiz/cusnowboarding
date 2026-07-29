import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Notice, formatDenver } from "@/components/ui";
import { RosterBoard, type RosterCardData } from "@/components/admin/roster-board";
import { requireCapability } from "../../../_lib/actor";
import { getRoster, getTripSummary } from "../../../_lib/queries";
import { saveRosterOrder } from "./actions";

export const dynamic = "force-dynamic";

export default async function RosterEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireCapability("managePromotions");

  const trip = await getTripSummary(id);
  if (!trip) notFound();

  const roster = await getRoster(id);
  // A held row past its deadline still holds its spot here: nothing lapses on a
  // trip whose results have not gone out, because nobody has been told they had
  // a deadline. Anything active is on this board.
  const active = roster.filter((row) => ["held", "paid", "waitlisted"].includes(row.status));

  const cards: RosterCardData[] = active.map((row) => ({
    id: row.id,
    name: `${row.first_name} ${row.last_name}`,
    email: row.email,
    claimSeq: row.claim_seq,
    isPaid: row.status === "paid",
    hasDues: row.is_club_member,
  }));

  const onTrip = active
    .filter((row) => row.status !== "waitlisted")
    .sort((a, b) => (a.spot_number ?? 0) - (b.spot_number ?? 0))
    .map((row) => row.id);
  const waitlisted = active
    .filter((row) => row.status === "waitlisted")
    .sort((a, b) => (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0))
    .map((row) => row.id);

  return (
    <div className="space-y-6">
      <header>
        <Link href={`/admin/trips/${trip.id}`} className="text-sm text-ink-muted hover:text-ink">
          {trip.title}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Edit the list</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Departs {formatDenver(trip.depart_at)} · Capacity {trip.capacity} ·{" "}
          {active.length} {active.length === 1 ? "entry" : "entries"}
        </p>
      </header>

      {trip.results_released_at ? (
        <>
          <Notice tone="alert" title="Results have already been sent">
            Sent {formatDenver(trip.results_released_at)}. Everyone who entered has been
            told where they stand, so the list cannot be reshuffled here any more -
            quietly moving someone off would strand a member who is expecting to go.
            Use Release, Cancel, and Promote on the roster, which notify people.
          </Notice>
          <Card>
            <Link
              href={`/admin/trips/${trip.id}`}
              className="text-sm font-medium text-accent hover:text-accent-hover"
            >
              Back to the roster
            </Link>
          </Card>
        </>
      ) : (
        <>
          <Notice tone="accent" title="Results have not been sent yet">
            The drop allocated spots strictly by arrival order. Nobody has been told
            anything beyond &ldquo;entry received&rdquo;, so you can move people freely
            until you press Send results on the roster. The number after a name is
            arrival order on drop night, which never changes.
          </Notice>

          <RosterBoard
            tripId={trip.id}
            capacity={trip.capacity}
            cards={cards}
            initialOnTrip={onTrip}
            initialWaitlisted={waitlisted}
            save={saveRosterOrder}
          />

          <p className="text-sm text-ink-muted">
            <Link
              href={`/admin/trips/${trip.id}`}
              className="font-medium text-accent hover:text-accent-hover"
            >
              Back to the roster
            </Link>{" "}
            to send results once the list is right.
          </p>
        </>
      )}
    </div>
  );
}
