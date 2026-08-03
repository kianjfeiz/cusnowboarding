import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Badge, Button, Notice, formatDenver, formatMoney } from "@/components/ui";
import { EmptyRow, PageHeader, Section, TableWrap, Td, Th } from "@/components/admin/shell";
import { RosterAdd } from "@/components/admin/roster-add";
import { RosterBoard, type RosterCardData } from "@/components/admin/roster-board";
import { SubmitButton } from "@/components/admin/submit-button";
import { can } from "@/lib/authz";
import { signupClosesAt } from "@/lib/signup-window";
import { requireActor } from "../../_lib/actor";
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
  promoteSignup,
  releaseSpot,
  releaseTripResults,
  saveRosterOrder,
  searchMembersToAdd,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * One screen for the whole drop.
 *
 * Which stage the trip is in decides what this page is: before results are sent
 * the job is curating, so the page IS the editor; afterwards the list is public
 * and every change has to be an announced one, so it becomes a table with
 * release, cancel, promote and the search box on it. Those two things are never
 * both true, which is why they are never both on screen.
 *
 * There is exactly one stage boundary the board crosses by hand - "Send
 * results". Closing signups, publishing outcomes and finalizing the roster were
 * three buttons that had to be pressed in the right order; they are one now, so
 * `sent` is the only stage after `curate`.
 */
type Stage = "before" | "drop" | "curate" | "sent" | "cancelled";

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

  // A row holding a spot, whether or not its deadline has run out: a lapsed hold
  // still physically occupies its spot_number until something releases it.
  const onTrip = roster.filter((row) => row.status === "held" || row.status === "paid");
  const waitlist = roster
    .filter((row) => row.status === "waitlisted")
    .sort(
      (a, b) =>
        (a.waitlist_position ?? a.claim_seq) - (b.waitlist_position ?? b.claim_seq),
    );
  const inactive = roster.filter((row) =>
    ["expired", "cancelled", "refunded"].includes(row.status),
  );

  const released = Boolean(trip.results_released_at);
  const mayCurate = can(actor, "managePromotions");
  const mayRefund = can(actor, "managePayments");

  const opensAt = new Date(trip.signup_opens_at);
  // The column is what the claim statement enforces; the derivation is the
  // fallback for a trip written before the close time was derived on save.
  const closesAt = new Date(trip.signup_closes_at ?? signupClosesAt(opensAt));

  const stage: Stage =
    trip.status === "cancelled"
      ? "cancelled"
      : released
        ? "sent"
        : now < opensAt.getTime()
          ? "before"
          : now < closesAt.getTime()
            ? "drop"
            : "curate";

  // The list is only editable in place while nobody has been told anything. A
  // cancelled trip is history, not work in progress.
  const curating = mayCurate && !released && stage !== "cancelled" && stage !== "before";

  const occupancy = occupancyOf(trip);
  // Before results, a hold cannot lapse in any sense the member could act on -
  // they were never told they had a deadline, and the reaper skips unreleased
  // trips - so everything sitting in a spot counts as occupying it. After
  // release the grace window in lib/holds.ts is the number that matters, and
  // occupancyOf is the only thing that computes it. Neither reads claim_counter.
  const taken = released ? occupancy.taken : onTrip.length;
  const free = released ? occupancy.free : Math.max(0, trip.capacity - taken);

  const unpaidHolds = onTrip.filter((row) => effectiveStatus(row, now) === "held").length;
  const lapsed = onTrip.filter((row) => effectiveStatus(row, now) === "lapsed").length;
  const collected = roster
    .filter((row) => row.status === "paid")
    .reduce((sum, row) => sum + row.amount_cents, 0);

  // Money recorded against a spot the member no longer holds. Derived rather
  // than flagged: nothing sets a flag now that payments are entered by hand.
  const needsReview = roster.filter(
    (row) =>
      row.payment_status === "paid" &&
      (row.status === "expired" || row.status === "cancelled"),
  );

  /*
    The one irreversible press on this page, so the confirmation spells out all
    of it rather than only the part the button is named after. A board member
    who reads "Send results" and expects signups to keep running is exactly who
    this sentence is for.
  */
  const sendResults = mayCurate ? (
    <form action={releaseTripResults}>
      <input type="hidden" name="tripId" value={trip.id} />
      <SubmitButton
        variant="primary"
        confirm={
          `Send results to everyone who entered? ${onTrip.length} will be told they are on the trip and ` +
          `${waitlist.length} will be told they are waitlisted. This also closes signups and opens the ` +
          `attendee list and photos to whoever pays. This cannot be undone.`
        }
      >
        Send results
      </SubmitButton>
    </form>
  ) : null;

  // Post-send, the search box is the only way onto a roster for somebody who
  // did not win a spot. Read-only board members do not get it.
  const addRider = mayCurate ? (
    <RosterAdd
      tripId={trip.id}
      freeSpots={free}
      notifies={released}
      search={searchMembersToAdd}
      add={addRiderToTrip}
    />
  ) : null;

  const stages: Record<Stage, { title: string; detail: ReactNode; action: ReactNode }> = {
    before: {
      title: "Signups have not opened",
      detail: `Entries open ${formatDenver(trip.signup_opens_at)}${
        trip.status === "draft" ? ", once this trip is published" : ""
      }. Nothing to do here until then - the trip opens itself.`,
      action: null,
    },
    drop: {
      title: "Signups are open",
      detail: `Spots are going out strictly by arrival order, and entrants have been told only that their entry was received. Entries can still arrive until ${formatDenver(
        closesAt,
      )}. Move people between the lists below, then send results - which closes signups too, so there is no need to close them first.`,
      action: null,
    },
    curate: {
      title: "Curating - nobody has been told anything",
      detail: null,
      action: null,
    },
    sent: {
      title: "Results sent - collecting payment",
      detail: (
        <>
          Sent {trip.results_released_at ? formatDenver(trip.results_released_at) : ""}.
          Signups are closed and the roster is final, so riders who pay can see who else is
          going and share photos. Anything that moves a spot from here notifies the person.
          {lapsed > 0
            ? ` ${lapsed} hold${lapsed === 1 ? " has" : "s have"} lapsed - release ${
                lapsed === 1 ? "it" : "them"
              } to free the spot, then promote someone from the waitlist.`
            : ""}
        </>
      ),
      action: null,
    },
    cancelled: {
      title: "Trip cancelled",
      detail: "Nobody is expected to pay. The list below is what it was when it was called off.",
      action: null,
    },
  };

  const current = stages[stage];

  return (
    <>
      <PageHeader
        title={trip.title}
        back={{ href: "/admin/trips", label: "Trips" }}
        subtitle={`Departs ${formatDenver(trip.depart_at)}`}
        actions={
          can(actor, "manageTrips") ? (
            <Link href={`/admin/trips/${trip.id}/edit`}>
              <Button variant="secondary">Edit trip</Button>
            </Link>
          ) : null
        }
      />

      <section className="mb-6 rounded-lg border border-border bg-paper px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink">{current.title}</p>
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">{current.detail}</p>
          </div>
          {current.action}
        </div>

        <p className="tnum mt-3.5 border-t border-border pt-3 text-sm">
          <span className="font-semibold">
            {taken}/{trip.capacity} filled
          </span>
          <span className="text-ink-muted">
            {" "}
            · {waitlist.length} waitlisted
            {released ? (
              <>
                {" "}
                · {unpaidHolds} unpaid hold{unpaidHolds === 1 ? "" : "s"}
                {lapsed > 0 ? ` · ${lapsed} lapsed` : ""} · {formatMoney(collected)} collected
              </>
            ) : null}
          </span>
        </p>
      </section>

      {needsReview.length > 0 ? (
        <div className="mb-6">
          <Notice tone="alert" title="Payment against a released spot">
            {needsReview.length} recorded payment{needsReview.length === 1 ? "" : "s"} belong
            to a spot that has since been released or cancelled. Reinstate the rider from
            Payments if there is room, or refund them.
          </Notice>
        </div>
      ) : null}

      {curating ? (
        <div className="space-y-6">
          <CurationBoard trip={trip} roster={roster} sendAction={sendResults} />
          {addRider ? (
            <Section
              title="Add a rider"
              description="Somebody who did not enter the drop. They land on the board above."
            >
              {addRider}
            </Section>
          ) : null}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Above the roster rather than below it: after results are out this
              is the board's most-used control on the page - people drop, other
              people take their place - and a thirty-row table should not be
              scrolled past to reach it. */}
          {addRider && stage !== "cancelled" ? (
            <Section
              title="Add a rider"
              description="Anyone in the club, whether or not they entered the drop."
            >
              {addRider}
            </Section>
          ) : null}

          <Section title="On the trip">
            <OnTripTable
              rows={onTrip}
              now={now}
              mayCurate={mayCurate}
              mayRefund={mayRefund}
            />
          </Section>

          <Section
            title="Waitlist"
            description={
              free > 0
                ? `${free} spot${free === 1 ? " is" : "s are"} free`
                : "No spot is free"
            }
          >
            <WaitlistTable
              rows={waitlist}
              free={free}
              mayCurate={mayCurate && stage !== "cancelled"}
            />
          </Section>

          {inactive.length > 0 ? (
            <details className="rounded-lg border border-border bg-paper">
              <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold">
                Released and cancelled ({inactive.length})
              </summary>
              <TableWrap>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border border-t border-border">
                    {inactive.map((row) => (
                      <tr key={row.id}>
                        <Td className="tnum text-ink-faint">#{row.claim_seq}</Td>
                        <Td>
                          {row.first_name} {row.last_name}
                        </Td>
                        <Td className="text-ink-muted">{row.email}</Td>
                        <Td>
                          <Badge emphasis="muted">
                            {STATUS_LABELS[effectiveStatus(row, now)]}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </details>
          ) : null}
        </div>
      )}

      <p className="mt-6 text-xs text-ink-muted">
        <a
          href={`/admin/trips/${trip.id}/roster.csv`}
          className="underline underline-offset-4 hover:text-ink"
        >
          Export CSV
        </a>
        {" · "}
        <Link
          href={`/admin/trips/${trip.id}/drop-log`}
          className="underline underline-offset-4 hover:text-ink"
        >
          Drop log
        </Link>
      </p>
    </>
  );
}

/**
 * The pre-release list. Held, paid and waitlisted rows all go on the board
 * together: before results, the difference between them is only which column
 * they happen to be sitting in, and moving one across is the whole job.
 */
function CurationBoard({
  trip,
  roster,
  sendAction,
}: {
  trip: { id: string; capacity: number };
  roster: RosterRow[];
  sendAction: ReactNode;
}) {
  const active = roster.filter((row) => ["held", "paid", "waitlisted"].includes(row.status));

  const cards: RosterCardData[] = active.map((row) => ({
    id: row.id,
    name: `${row.first_name} ${row.last_name}`,
    email: row.email,
    claimSeq: row.claim_seq,
    isPaid: row.status === "paid",
    hasDues: row.is_club_member,
  }));

  return (
    <RosterBoard
      /*
        Remount whenever the set of people changes. The board holds its baseline
        in client state, so a rider added through the search box below would
        otherwise leave it editing a list it cannot save - applyRosterAssignment
        refuses an ordering that omits an active signup, and the board member
        would only find out when Save failed.
      */
      key={active.map((row) => row.id).join(",")}
      tripId={trip.id}
      capacity={trip.capacity}
      cards={cards}
      initialOnTrip={active
        .filter((row) => row.status !== "waitlisted")
        .sort((a, b) => (a.spot_number ?? 0) - (b.spot_number ?? 0))
        .map((row) => row.id)}
      initialWaitlisted={active
        .filter((row) => row.status === "waitlisted")
        .sort((a, b) => (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0))
        .map((row) => row.id)}
      save={saveRosterOrder}
      sendAction={sendAction}
    />
  );
}

function OnTripTable({
  rows,
  now,
  mayCurate,
  mayRefund,
}: {
  rows: RosterRow[];
  now: number;
  mayCurate: boolean;
  mayRefund: boolean;
}) {
  return (
    <TableWrap>
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            <Th className="text-right">Spot</Th>
            <Th>Rider</Th>
            <Th>Status</Th>
            <Th>Due</Th>
            <Th className="text-right">Amount</Th>
            <Th />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <EmptyRow colSpan={6}>Nobody has claimed a spot yet.</EmptyRow>
          ) : (
            rows.map((row) => {
              const status = effectiveStatus(row, now);
              return (
                <tr key={row.id} className="hover:bg-surface">
                  <Td className="tnum text-right font-medium">{row.spot_number ?? "-"}</Td>
                  <Td>
                    <div>
                      {row.first_name} {row.last_name}
                      {row.promoted_at ? (
                        <span className="ml-2 text-xs text-ink-faint">Promoted</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {row.email}
                      {row.phone ? ` · ${row.phone}` : ""}
                    </div>
                  </Td>
                  <Td>
                    <Badge emphasis={status === "paid" ? "strong" : "normal"}>
                      {STATUS_LABELS[status]}
                    </Badge>
                    {row.paid_offline ? (
                      <div className="mt-1 text-xs text-ink-faint">
                        Offline{row.offline_note ? `: ${row.offline_note}` : ""}
                      </div>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {status === "paid"
                      ? row.paid_at
                        ? formatDenver(row.paid_at)
                        : "Paid"
                      : row.payment_deadline_at
                        ? formatDenver(row.payment_deadline_at)
                        : "-"}
                  </Td>
                  <Td className="tnum text-right">{formatMoney(row.amount_cents)}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {/*
                      One action per row, chosen by what the row actually is. A
                      hold is released - the spot goes back to the waitlist. A
                      paid rider is a refund conversation, which is why it is the
                      treasurer's button and not the coordinator's.
                    */}
                    {mayCurate && row.status === "held" ? (
                      <form action={releaseSpot}>
                        <input type="hidden" name="signupId" value={row.id} />
                        <input type="hidden" name="reason" value="board_release" />
                        <SubmitButton
                          variant="danger"
                          confirm={`Release ${row.first_name} ${row.last_name}'s spot? It goes back to the waitlist and cannot be undone from here.`}
                        >
                          Release
                        </SubmitButton>
                      </form>
                    ) : null}
                    {mayRefund && row.status === "paid" ? (
                      <form action={cancelSignup}>
                        <input type="hidden" name="signupId" value={row.id} />
                        <SubmitButton
                          variant="quiet"
                          confirm={`Cancel ${row.first_name} ${row.last_name}'s signup? They have already paid - you will need to refund them separately.`}
                        >
                          Cancel
                        </SubmitButton>
                      </form>
                    ) : null}
                  </Td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </TableWrap>
  );
}

function WaitlistTable({
  rows,
  free,
  mayCurate,
}: {
  rows: RosterRow[];
  free: number;
  mayCurate: boolean;
}) {
  return (
    <TableWrap>
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            <Th className="text-right">Order</Th>
            <Th>Rider</Th>
            <Th className="text-right">Arrival</Th>
            <Th />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <EmptyRow colSpan={4}>Nobody is waitlisted.</EmptyRow>
          ) : (
            rows.map((row, index) => (
              <tr key={row.id} className="hover:bg-surface">
                <Td className="tnum text-right font-medium">
                  {row.waitlist_position ?? index + 1}
                </Td>
                <Td>
                  <div>
                    {row.first_name} {row.last_name}
                  </div>
                  <div className="text-xs text-ink-muted">{row.email}</div>
                </Td>
                <Td className="tnum text-right text-ink-faint">
                  <span title="Arrival order on drop night">#{row.claim_seq}</span>
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {mayCurate ? (
                    <div className="flex items-center justify-end gap-2">
                      <form action={promoteSignup}>
                        <input type="hidden" name="signupId" value={row.id} />
                        {/*
                          Disabled is a courtesy only. promoteFromWaitlist takes
                          the trip row lock and re-checks that a spot is genuinely
                          free, so two coordinators clicking at once cannot both
                          be handed the same seat.
                        */}
                        <SubmitButton
                          disabled={free === 0}
                          title={free === 0 ? "No spot is free" : undefined}
                          confirm={`Give ${row.first_name} ${row.last_name} a spot? They are emailed straight away with a payment deadline.`}
                        >
                          Promote
                        </SubmitButton>
                      </form>
                      {/* The waitlist had no way off it except upwards, so a
                          rider who told the board they were out stayed on the
                          list and got promoted weeks later. */}
                      <form action={cancelSignup}>
                        <input type="hidden" name="signupId" value={row.id} />
                        <SubmitButton
                          variant="quiet"
                          confirm={`Take ${row.first_name} ${row.last_name} off the waitlist? They are not told, and they would have to enter again.`}
                        >
                          Remove
                        </SubmitButton>
                      </form>
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableWrap>
  );
}
