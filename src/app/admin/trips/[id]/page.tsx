import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Notice, formatDenver, formatMoney } from "@/components/ui";
import { CARD_BUTTON, DataTable, PageHeader, Section, Td } from "@/components/admin/shell";
import { RosterAdd } from "@/components/admin/roster-add";
import { RosterBoard, type RosterCardData } from "@/components/admin/roster-board";
import { SubmitButton } from "@/components/admin/submit-button";
import { can } from "@/lib/auth/authz";
import { requireActor } from "../../_lib/actor";
import { PHASE_LABELS, tripPhase } from "../../_lib/trip-status";
import {
  STATUS_LABELS,
  effectiveStatus,
  getRoster,
  getTripSummary,
  occupancyOf,
  type RosterRow,
} from "../../_lib/queries";
import {
  addRiderToTrip,
  cancelSignup,
  releaseSpot,
  releaseTripResults,
  saveRosterOrder,
  searchMembersToAdd,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * One screen for the whole drop. From the moment signups open the page IS the
 * drag-and-drop roster, before the roster is released and after. "Release roster
 * and notify" is the only boundary the board crosses by hand; after it, each
 * card also carries its payment state and the remove actions.
 */
export default async function TripRosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const trip = await getTripSummary(id);
  if (!trip) notFound();

  const roster = await getRoster(id);
  const now = Date.now();

  // Comped board riders are on the trip but not in the capacity, so they stay
  // out of every list and count below.
  const boardSeats = roster.filter((row) => row.board_seat && row.status === "paid");
  // A lapsed hold still physically occupies its spot_number until released.
  const onTrip = roster.filter(
    (row) => !row.board_seat && (row.status === "held" || row.status === "paid"),
  );
  const waitlist = roster.filter((row) => row.status === "waitlisted");
  const inactive = roster.filter((row) =>
    ["expired", "cancelled", "refunded"].includes(row.status),
  );

  const released = Boolean(trip.results_released_at);
  const cancelled = trip.status === "cancelled";
  const mayCurate = can(actor, "managePromotions");
  const mayRefund = can(actor, "managePayments");

  // The same phase, and the same words, as the trips list and the dashboard.
  // It reads the window exactly as the claim statement does.
  const phase = tripPhase(trip, now);
  const opensAt = new Date(trip.signup_opens_at).getTime();

  // Editable in place at every stage until the trip is called off.
  const editable = mayCurate && !cancelled;
  // Taking someone off while entries are still open would let them simply
  // enter again, and would show them an outcome before the roster is out.
  const mayRemove = released || (phase !== "live" && phase !== "upcoming");
  // Before signups open there is nobody to tell, and releasing would close a
  // drop that has not happened yet.
  const mayRelease = editable && !released && now >= opensAt;

  // Before results a hold cannot lapse in any sense the member could act on, so
  // everything in a spot occupies it. After release the grace window applies,
  // and occupancyOf is the only thing that computes it.
  const taken = released ? occupancyOf(trip).taken : onTrip.length;
  const free = Math.max(0, trip.capacity - taken);

  const collected = roster
    .filter((row) => row.status === "paid")
    .reduce((sum, row) => sum + row.amount_cents, 0);

  // Money recorded against a spot the member no longer holds.
  const needsReview = roster.filter(
    (row) =>
      row.payment_status === "paid" &&
      (row.status === "expired" || row.status === "cancelled"),
  ).length;

  const stage: { title: string; detail: string } = (() => {
    switch (phase) {
      case "cancelled":
        return { title: "Trip cancelled", detail: "Nobody is expected to pay." };
      case "sent":
        return {
          title: PHASE_LABELS.sent,
          detail: `Released ${formatDenver(trip.results_released_at ?? new Date(now))}`,
        };
      case "draft":
        return {
          title: PHASE_LABELS.draft,
          detail: `Signups open ${formatDenver(trip.signup_opens_at)}, once this trip is published.`,
        };
      case "upcoming":
        return {
          title: PHASE_LABELS.upcoming,
          detail: `They open by themselves ${formatDenver(trip.signup_opens_at)}.`,
        };
      case "live":
        return {
          title: PHASE_LABELS.live,
          detail:
            (trip.signup_closes_at
              ? `Entries arrive in order until ${formatDenver(trip.signup_closes_at)}. `
              : "Entries arrive in order. ") +
            'Entrants see only "entry received" until you release the roster.',
        };
      case "completed":
        return { title: PHASE_LABELS.completed, detail: "This trip has run." };
      default:
        return { title: PHASE_LABELS[phase], detail: "Nobody has been told anything yet." };
    }
  })();

  // After release a card carries where the rider stands on payment.
  const cardStatus = (row: RosterRow): Pick<RosterCardData, "status" | "note"> => {
    if (!released) return {};
    if (row.status === "paid") {
      return {
        status: STATUS_LABELS.paid,
        // Where the money came from, when the treasurer recorded it by hand.
        note: row.paid_offline ? row.offline_note : null,
      };
    }
    if (row.status !== "held") return {};
    const status = effectiveStatus(row, now);
    return {
      status: STATUS_LABELS[status],
      note:
        status === "held" && row.payment_deadline_at
          ? `Due ${formatDenver(row.payment_deadline_at, { timeZoneName: undefined })}`
          : null,
    };
  };

  // One remove button per card once removing is safe. A paid rider is a refund,
  // so theirs needs the payments capability; the rest are curation.
  const cardActions = (row: RosterRow) => {
    if (!mayRemove) return null;
    const name = `${row.first_name} ${row.last_name}`;
    const remove = (action: (formData: FormData) => Promise<void>, label: string, confirm: string) => (
      <form action={action}>
        <input type="hidden" name="signupId" value={row.id} />
        <SubmitButton variant="danger" confirm={confirm} className={CARD_BUTTON}>
          {label}
        </SubmitButton>
      </form>
    );
    if (row.status === "held" && mayCurate) {
      return remove(releaseSpot, "Remove from trip", `Remove ${name} from the trip? They are not emailed.`);
    }
    if (row.status === "paid" && mayRefund) {
      return remove(
        cancelSignup,
        "Remove from trip",
        `Remove ${name} from the trip? They have paid - refund them separately. They are not emailed.`,
      );
    }
    if (row.status === "waitlisted" && mayCurate) {
      return remove(
        cancelSignup,
        "Remove from waitlist",
        `Remove ${name} from the waitlist? They are not emailed.`,
      );
    }
    return null;
  };

  const card = (row: RosterRow): RosterCardData => ({
    id: row.id,
    name: `${row.first_name} ${row.last_name}`,
    email: row.email,
    claimSeq: row.claim_seq,
    isPaid: row.status === "paid",
    hasDues: row.is_club_member,
    phone: row.phone,
    promoted: row.promoted_at !== null,
    ...cardStatus(row),
    actions: cardActions(row),
  });

  const stageBanner = (
    <section className="rounded-lg border border-border bg-paper px-5 py-4">
      <p className="text-sm font-semibold text-ink">{stage.title}</p>
      <p className="mt-1 text-sm text-ink-muted">{stage.detail}</p>
      {released ? (
        <p className="tnum mt-3 border-t border-border pt-3 text-sm text-ink-muted">
          {trip.held} unpaid
          {trip.lapsed > 0 ? ` · ${trip.lapsed} lapsed` : ""} · {formatMoney(collected)} collected
        </p>
      ) : null}
    </section>
  );

  return (
    <>
      <PageHeader
        title={trip.title}
        back={{ href: "/admin/trips", label: "Trips" }}
        subtitle={`Departs ${formatDenver(trip.depart_at)}`}
        actions={
          <>
            <a
              href={`/admin/trips/${trip.id}/roster.csv`}
              className="inline-flex h-10 items-center rounded-md px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-paper hover:text-ink"
            >
              Export CSV
            </a>
            {can(actor, "manageTrips") ? (
              <Link href={`/admin/trips/${trip.id}/edit`}>
                <Button variant="secondary">Edit trip</Button>
              </Link>
            ) : null}
          </>
        }
      />

      <div className="space-y-6">
        {editable ? (
          // Side by side: the stage is short, and adding a rider is the most
          // used control once the roster is out.
          <div className="grid items-start gap-4 md:grid-cols-2">
            {stageBanner}
            <Section title="Add a rider" description="Anyone in the club, whether or not they entered.">
              <RosterAdd
                tripId={trip.id}
                canWaitlist={released || free === 0}
                search={searchMembersToAdd}
                add={addRiderToTrip}
              />
            </Section>
          </div>
        ) : (
          stageBanner
        )}

        {needsReview > 0 ? (
          <Notice tone="alert" title="Paid, but no longer on the trip">
            {needsReview} rider{needsReview === 1 ? " who paid has" : "s who paid have"} since
            been removed.{" "}
            <Link
              href={`/admin/payments?status=all&trip=${trip.id}`}
              className="text-accent underline underline-offset-4"
            >
              Reinstate from Payments
            </Link>{" "}
            if there is room, or refund them.
          </Notice>
        ) : null}

        <RosterBoard
          // Remount whenever the set of people changes. The board keeps its
          // baseline in client state, and applyRosterAssignment refuses an
          // ordering that omits an active signup, so a rider added above would
          // otherwise leave it editing a list it cannot save.
          key={[...onTrip, ...waitlist]
            .map((row) => row.id)
            .sort()
            .join(",")}
          tripId={trip.id}
          capacity={trip.capacity}
          onTrip={onTrip.map(card)}
          waitlisted={waitlist.map(card)}
          save={saveRosterOrder}
          editable={editable}
          sendAction={
            mayRelease ? (
              <form action={releaseTripResults}>
                <input type="hidden" name="tripId" value={trip.id} />
                {/* The one irreversible press here, so the confirmation spells
                    out everything it does, not only what it is named after. */}
                <SubmitButton
                  variant="primary"
                  pendingLabel="Releasing"
                  className="h-10 px-4 text-sm"
                  confirm={
                    `Release the roster? The ${onTrip.length} on the trip are emailed; the ${waitlist.length} waitlisted are not. ` +
                    `This also closes signups and opens the attendee list to whoever pays. This cannot be undone.`
                  }
                >
                  Release roster and notify
                </SubmitButton>
              </form>
            ) : null
          }
        />

        {/* Shown in every stage: the board is seated when the trip is created,
            and removing whoever is not coming is curation work. */}
        {boardSeats.length > 0 ? (
          <Section
            title={`Board seats (${boardSeats.length})`}
            description={`Free, and not counted in the capacity.${
              editable ? " Remove anyone who is not coming." : ""
            }`}
          >
            <ul className="grid gap-2 p-2 sm:grid-cols-2 lg:grid-cols-3">
              {boardSeats.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate text-sm font-medium">
                      {row.first_name} {row.last_name}
                    </p>
                    <p className="truncate text-xs text-ink-muted">{row.email}</p>
                  </div>
                  {editable ? (
                    <form action={cancelSignup}>
                      <input type="hidden" name="signupId" value={row.id} />
                      <SubmitButton
                        variant="danger"
                        className={CARD_BUTTON}
                        confirm={`Remove ${row.first_name} ${row.last_name} from the trip? They are not emailed.`}
                      >
                        Remove from trip
                      </SubmitButton>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {inactive.length > 0 ? (
          <details className="rounded-lg border border-border bg-paper">
            <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold">
              No longer on the trip ({inactive.length})
            </summary>
            <div className="border-t border-border">
              <DataTable>
                {inactive.map((row) => (
                  <tr key={row.id}>
                    <Td>
                      {row.first_name} {row.last_name}
                    </Td>
                    <Td className="text-ink-muted">{row.email}</Td>
                    <Td className="text-right">
                      <Badge emphasis="muted">
                        {STATUS_LABELS[effectiveStatus(row, now)]}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </DataTable>
            </div>
          </details>
        ) : null}
      </div>
    </>
  );
}
