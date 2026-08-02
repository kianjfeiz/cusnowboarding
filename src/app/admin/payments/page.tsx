import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyRow, PageHeader, Section, Stat, TableWrap, Td, Th } from "@/components/admin/shell";
import { SubmitButton } from "@/components/admin/submit-button";
import { Badge, Button, Notice, formatDenver, formatMoney } from "@/components/ui";
import { can } from "@/lib/authz";
import { requireCapability } from "../_lib/actor";
import {
  LINE_LIMIT,
  PAYMENT_FILTERS,
  PAYMENT_FILTER_LABELS,
  PAYMENT_STATE_LABELS,
  filterPaymentLines,
  getPaymentTotals,
  listLiveTrips,
  listPaymentLines,
  listPaymentTripOptions,
  outstandingCents,
  paidVia,
  parsePaymentFilter,
  paymentState,
  resolveTripId,
  type PaymentLine,
  type PaymentState,
} from "../_lib/payment-queries";
import {
  recordPaymentAction,
  reinstateSignupAction,
  sendUnpaidRemindersAction,
} from "./actions";
import { PaymentSourceFields } from "./payment-source-fields";
import { MAX_BATCH, listUnpaidRecipients, type UnpaidRecipient } from "./unpaid";

export const dynamic = "force-dynamic";

/** The table carries a lot of timestamps; the zone is stated once, in the header. */
const at = (value: Date | string) => formatDenver(value, { timeZoneName: undefined });

/** Statuses a signup can be put back from. Mirrors lib/reinstate.ts. */
const REINSTATABLE_STATES: PaymentState[] = ["released", "cancelled", "refunded"];

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    trip?: string;
    mailTrip?: string;
    mailLapsed?: string;
    mailPreview?: string;
    mailSent?: string;
    mailFailed?: string;
  }>;
}) {
  const actor = await requireCapability("viewRosters");
  const mayManage = can(actor, "managePayments");

  const params = await searchParams;
  // The page opens on what the treasurer came for: the people who still owe
  // money. The full ledger is one selection away.
  const filter = parsePaymentFilter(params.status ?? "owing");

  const tripOptions = await listPaymentTripOptions();
  const tripId = resolveTripId(params.trip, tripOptions);

  const [totals, liveTrips, allLines] = await Promise.all([
    getPaymentTotals(),
    listLiveTrips(),
    listPaymentLines(tripId),
  ]);

  const now = Date.now();
  const lines = filterPaymentLines(allLines, filter, now);
  const outstanding = outstandingCents(totals);
  const noLink = liveTrips.filter((trip) => !trip.payment_url);

  // The batch reminder has its own scope, kept separate from the table filters
  // so that narrowing the table cannot silently change who gets mailed.
  const mailTripId = liveTrips.some((trip) => trip.id === params.mailTrip)
    ? params.mailTrip!
    : null;
  const includeLapsed = params.mailLapsed === "1";
  const previewing = mayManage && params.mailPreview === "1";
  const recipients: UnpaidRecipient[] = previewing
    ? await listUnpaidRecipients(mailTripId, includeLapsed, now)
    : [];

  const sentCount = Number(params.mailSent ?? "");
  const sendReport =
    params.mailSent !== undefined && Number.isFinite(sentCount)
      ? { sent: sentCount, failed: Number(params.mailFailed ?? 0) || 0 }
      : null;

  const narrowed = params.status !== undefined || tripId !== null;
  // Reconciliation is done against the whole ledger, so the export follows the
  // chosen trip but never the status filter.
  const csvHref = `/admin/payments/reconciliation.csv${tripId ? `?trip=${tripId}` : ""}`;

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="The club bills through Fusion, which this app cannot read, so a spot counts as paid once someone records it here. Times are Mountain."
        actions={
          mayManage ? (
            <a
              href={csvHref}
              className="inline-flex h-10 items-center rounded-md border border-border-strong px-3 text-xs font-medium hover:bg-surface sm:h-8"
            >
              Reconciliation CSV
            </a>
          ) : null
        }
      />

      {sendReport ? (
        <div className="mb-6">
          <Notice
            tone={sendReport.failed > 0 ? "alert" : "accent"}
            title={`${sendReport.sent} reminder${sendReport.sent === 1 ? "" : "s"} sent`}
          >
            {sendReport.failed > 0
              ? `${sendReport.failed} could not be delivered and were not retried. The addresses are in the audit log; chase those members individually rather than resending the batch.`
              : "Every member in that scope was emailed individually."}
          </Notice>
        </div>
      ) : null}

      {noLink.length > 0 ? (
        <div className="mb-6">
          <Notice title="No payment link set">
            Members have nowhere to pay for{" "}
            {noLink.map((trip, index) => (
              <span key={trip.id}>
                {index > 0 ? ", " : ""}
                <Link
                  href={`/admin/trips/${trip.id}/edit`}
                  className="text-accent underline underline-offset-4"
                >
                  {trip.title}
                </Link>
              </span>
            ))}
            . Set the Fusion link on the trip.
          </Notice>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:max-w-lg">
        <Stat
          label="Outstanding"
          value={formatMoney(outstanding)}
          detail={`${totals.unpaid_count} unpaid, ${totals.lapsed_count} lapsed`}
        />
        <Stat
          label="Collected"
          value={formatMoney(totals.collected_cents)}
          detail={`${totals.paid_count} paid`}
        />
      </div>

      <Section
        title={
          filter === "all"
            ? `${lines.length} signup${lines.length === 1 ? "" : "s"}`
            : `${lines.length} ${filter}`
        }
        description={
          allLines.length >= LINE_LIMIT
            ? `Showing the first ${LINE_LIMIT}. Pick a trip to narrow it down.`
            : undefined
        }
        actions={
          <form method="get" className="flex flex-wrap items-center gap-2">
            <FilterSelect name="status" label="Status" value={filter}>
              {PAYMENT_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {PAYMENT_FILTER_LABELS[value]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect name="trip" label="Trip" value={tripId ?? ""}>
              <option value="">All trips</option>
              {tripOptions.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.title}
                </option>
              ))}
            </FilterSelect>
            <Button type="submit" variant="secondary" className="h-8 px-3 text-xs">
              Apply
            </Button>
            {narrowed ? (
              <Link
                href="/admin/payments"
                className="text-xs text-ink-muted underline underline-offset-4 hover:text-ink"
              >
                Reset
              </Link>
            ) : null}
          </form>
        }
      >
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <Th>Member</Th>
                <Th>Trip</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
                <Th>Recorded</Th>
                {mayManage ? <Th /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.length === 0 ? (
                <EmptyRow colSpan={mayManage ? 6 : 5}>
                  {filter === "owing"
                    ? "Nobody owes the club money."
                    : "Nothing matches that filter."}
                </EmptyRow>
              ) : (
                lines.map((line) => (
                  <PaymentRow key={line.signup_id} line={line} now={now} mayManage={mayManage} />
                ))
              )}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      {mayManage ? (
        <div className="mt-6">
          <UnpaidMailer
            trips={liveTrips}
            mailTripId={mailTripId}
            includeLapsed={includeLapsed}
            previewing={previewing}
            recipients={recipients}
          />
        </div>
      ) : null}
    </>
  );
}

/**
 * Batch reminder to everyone with an outstanding balance.
 *
 * Deliberately two steps. The first is a plain GET that only re-renders the
 * page with the recipient list resolved; nothing is sent and nothing is
 * written. Only the second form, which carries the count the treasurer actually
 * read, can send. Contacting forty members at once is not something anyone
 * should be able to do by mis-clicking, and a bare count is not enough to
 * confirm against - the names have to be on screen.
 */
function UnpaidMailer({
  trips,
  mailTripId,
  includeLapsed,
  previewing,
  recipients,
}: {
  trips: Array<{ id: string; title: string }>;
  mailTripId: string | null;
  includeLapsed: boolean;
  previewing: boolean;
  recipients: UnpaidRecipient[];
}) {
  const total = recipients.reduce((sum, row) => sum + row.amount_cents, 0);
  const overCap = recipients.length > MAX_BATCH;

  return (
    <details open={previewing} className="rounded-lg border border-border bg-paper">
      <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-ink">
        Email members who owe money
      </summary>

      <div className="space-y-4 border-t border-border px-5 py-4">
        <form method="get" className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="mailPreview" value="1" />
          <FilterSelect name="mailTrip" label="Scope" value={mailTripId ?? ""}>
            <option value="">All live trips</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.title}
              </option>
            ))}
          </FilterSelect>
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              name="mailLapsed"
              value="1"
              defaultChecked={includeLapsed}
              className="h-4 w-4 accent-accent"
            />
            <span>Include lapsed holds</span>
          </label>
          <Button type="submit" variant="secondary" className="h-8 px-3 text-xs">
            {previewing ? "Update list" : "Preview recipients"}
          </Button>
        </form>

        <p className="text-xs text-ink-faint">
          One personalised message each, with their own payment link; nobody sees anyone
          else&apos;s address. A lapsed hold is on its way to release, so asking for payment may
          be asking for a spot the member is about to lose - it is left out unless you tick
          the box. Trips whose results are not out yet are skipped: those members have not
          been told they have a spot.
        </p>

        {previewing ? (
          recipients.length === 0 ? (
            <Notice title="Nobody to email">
              No outstanding balances in that scope
              {includeLapsed ? "." : ", though there may be lapsed holds. Tick the box to include them."}
            </Notice>
          ) : (
            <div className="space-y-3">
              <TableWrap>
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      <Th>Member</Th>
                      <Th>Email</Th>
                      <Th>Trip</Th>
                      <Th className="text-right">Owes</Th>
                      <Th>Deadline</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recipients.map((row) => (
                      <tr key={row.signup_id} className="hover:bg-surface">
                        <Td className="whitespace-nowrap font-medium">
                          {row.first_name} {row.last_name}
                        </Td>
                        <Td className="whitespace-nowrap text-ink-muted">{row.email}</Td>
                        <Td className="whitespace-nowrap">{row.trip_title}</Td>
                        <Td className="tnum whitespace-nowrap text-right">
                          {formatMoney(row.amount_cents)}
                        </Td>
                        <Td className="whitespace-nowrap text-ink-muted">
                          {at(row.payment_deadline_at)}
                          {row.lapsed ? (
                            <span className="ml-2 text-xs text-ink-faint">lapsed</span>
                          ) : null}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-ink-muted">
                  <span className="tnum font-medium text-ink">{recipients.length}</span>{" "}
                  recipient{recipients.length === 1 ? "" : "s"}, {formatMoney(total)} outstanding.
                </p>

                {overCap ? (
                  <Notice tone="alert" title="Too many at once">
                    That scope covers more than {MAX_BATCH} members. Send it one trip at a time.
                  </Notice>
                ) : (
                  <form action={sendUnpaidRemindersAction}>
                    <input type="hidden" name="tripId" value={mailTripId ?? ""} />
                    {includeLapsed ? (
                      <input type="hidden" name="includeLapsed" value="1" />
                    ) : null}
                    {/* Re-checked on the server: a list that moved since this
                        page rendered is refused rather than quietly widened. */}
                    <input type="hidden" name="expectedCount" value={recipients.length} />
                    <SubmitButton
                      variant="primary"
                      pendingLabel="Sending"
                      confirm={`Send ${recipients.length} separate email${recipients.length === 1 ? "" : "s"}, one per member. This cannot be undone.`}
                    >
                      {`Send ${recipients.length} email${recipients.length === 1 ? "" : "s"}`}
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>
          )
        ) : null}
      </div>
    </details>
  );
}

function PaymentRow({
  line,
  now,
  mayManage,
}: {
  line: PaymentLine;
  now: number;
  mayManage: boolean;
}) {
  const state = paymentState(line, now);
  const via = paidVia(line);
  const owing = state === "unpaid" || state === "lapsed";
  const canReinstate = REINSTATABLE_STATES.includes(state);
  const who = `${line.first_name} ${line.last_name}`;

  return (
    <tr className="hover:bg-surface">
      <Td className="whitespace-nowrap">
        <span className="font-medium">{who}</span>
        <span className="mt-0.5 block text-xs text-ink-faint">{line.email}</span>
      </Td>
      <Td className="whitespace-nowrap">
        <Link href={`/admin/trips/${line.trip_id}`} className="hover:underline">
          {line.trip_title}
        </Link>
      </Td>
      <Td className="tnum whitespace-nowrap text-right">
        {formatMoney(line.amount_cents)}
        {line.refunded_cents > 0 ? (
          <span className="mt-0.5 block text-xs text-ink-faint">
            {formatMoney(line.refunded_cents)} refunded
          </span>
        ) : null}
      </Td>
      <Td className="whitespace-nowrap">
        <Badge emphasis={state === "paid" ? "strong" : "normal"}>
          {PAYMENT_STATE_LABELS[state]}
        </Badge>
        {/* The deadline is only news while money is still owed. */}
        {owing && line.payment_deadline_at ? (
          <span className="mt-0.5 block text-xs text-ink-faint">
            Due {at(line.payment_deadline_at)}
          </span>
        ) : null}
      </Td>
      <Td className="whitespace-nowrap">
        {via.label === "-" ? (
          <span className="text-ink-faint">-</span>
        ) : (
          <>
            <span>{via.label}</span>
            <span className="mt-0.5 block text-xs text-ink-faint">
              {[via.note, line.paid_at ? at(line.paid_at) : null].filter(Boolean).join(" · ")}
            </span>
          </>
        )}
      </Td>
      {mayManage ? (
        <Td>
          {owing ? (
            <details className="min-w-56">
              {/* Padding rather than a height: `summary` is a list-item, and
                  changing its display to size it would drop the disclosure
                  triangle. Vertical padding gives the phone a real tap target
                  and leaves the desktop row height alone. */}
              <summary className="cursor-pointer py-3 text-xs text-accent underline underline-offset-4 sm:py-0">
                Record payment
              </summary>
              <form action={recordPaymentAction} className="mt-2 space-y-1.5">
                <input type="hidden" name="signupId" value={line.signup_id} />
                <PaymentSourceFields
                  who={who}
                  fusionNeedsReference
                  submit={<SubmitButton pendingLabel="Saving">Record</SubmitButton>}
                />
              </form>
            </details>
          ) : null}
          {canReinstate ? (
            <details className="min-w-56">
              {/* Padding rather than a height: `summary` is a list-item, and
                  changing its display to size it would drop the disclosure
                  triangle. Vertical padding gives the phone a real tap target
                  and leaves the desktop row height alone. */}
              <summary className="cursor-pointer py-3 text-xs text-accent underline underline-offset-4 sm:py-0">
                Reinstate
              </summary>
              <form action={reinstateSignupAction} className="mt-2 space-y-1.5">
                <input type="hidden" name="signupId" value={line.signup_id} />
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    name="markPaid"
                    value="1"
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  <span>Money already received</span>
                </label>
                <PaymentSourceFields
                  who={who}
                  fusionNeedsReference={false}
                  submit={
                    <SubmitButton
                      pendingLabel="Reinstating"
                      confirm={`Put ${who} back on ${line.trip_title}? They take the lowest free spot and are emailed.`}
                    >
                      Reinstate
                    </SubmitButton>
                  }
                  hint="Leave the box clear to give them a fresh payment window; the payment fields are then ignored."
                />
              </form>
            </details>
          ) : null}
        </Td>
      ) : null}
    </tr>
  );
}

function FilterSelect({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-muted">
      <span>{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="h-8 max-w-48 rounded-md border border-border bg-paper px-2 text-xs text-ink focus:border-accent focus:outline-none"
      >
        {children}
      </select>
    </label>
  );
}
