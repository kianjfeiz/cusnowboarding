import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyRow, PageHeader, Section, Stat, TableWrap, Td, Th } from "@/components/admin/shell";
import { SubmitButton } from "@/components/admin/submit-button";
import { Badge, Button, Input, Notice, cn, formatDenver, formatMoney } from "@/components/ui";
import { can } from "@/lib/authz";
import { requireCapability } from "../_lib/actor";
import {
  LINE_LIMIT,
  PAYMENT_FILTERS,
  PAYMENT_FILTER_LABELS,
  PAYMENT_PROVIDERS,
  PAYMENT_PROVIDER_LABELS,
  PAYMENT_STATE_LABELS,
  filterPaymentLines,
  getPaymentTotals,
  listPaymentLines,
  listPaymentTripOptions,
  listTripPaymentTotals,
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
  const filter = parsePaymentFilter(params.status);

  const tripOptions = await listPaymentTripOptions();
  const tripId = resolveTripId(params.trip, tripOptions);

  const [totals, byTrip, allLines] = await Promise.all([
    getPaymentTotals(),
    listTripPaymentTotals(),
    listPaymentLines(tripId),
  ]);

  const now = Date.now();
  const lines = filterPaymentLines(allLines, filter, now);
  const outstanding = outstandingCents(totals);
  const unsettled = totals.unpaid_count + totals.lapsed_count;

  // The batch reminder has its own scope, kept separate from the table filters
  // so that narrowing the table cannot silently change who gets mailed.
  const mailTripId = byTrip.some((trip) => trip.trip_id === params.mailTrip)
    ? params.mailTrip!
    : null;
  const includeLapsed = params.mailLapsed === "1";
  const previewing = mayManage && params.mailPreview === "1";
  const recipients: UnpaidRecipient[] = previewing
    ? await listUnpaidRecipients(mailTripId, includeLapsed, now)
    : [];

  const sentCount = Number(params.mailSent ?? "");
  const failedCount = Number(params.mailFailed ?? "");
  const sendReport = Number.isFinite(sentCount) && params.mailSent !== undefined
    ? { sent: sentCount, failed: Number.isFinite(failedCount) ? failedCount : 0 }
    : null;

  const query = new URLSearchParams();
  if (filter !== "all") query.set("status", filter);
  if (tripId) query.set("trip", tripId);
  const search = query.toString();
  const csvHref = `/admin/payments/reconciliation.csv${search ? `?${search}` : ""}`;
  const filtered = search !== "";

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Who has paid, who has not, and what the club is still owed. The club bills through Fusion, which this app cannot read, so a spot is paid once someone here records it. Totals cover scheduled, open, and closed trips. All times are Mountain."
        actions={
          mayManage ? (
            <a
              href={csvHref}
              className="inline-flex h-8 items-center rounded-md border border-border-strong px-3 text-xs font-medium hover:bg-surface"
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
              ? `${sendReport.failed} could not be delivered and were not retried. The addresses are recorded in the audit log; chase those members individually rather than resending the batch.`
              : "Every member in that scope was emailed individually."}
          </Notice>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Expected"
          value={formatMoney(totals.expected_cents)}
          detail={`${totals.allocated_count} spot${totals.allocated_count === 1 ? "" : "s"} allocated`}
        />
        <Stat
          label="Collected"
          value={formatMoney(totals.collected_cents)}
          detail={
            totals.refunded_cents > 0
              ? `${totals.paid_count} paid, ${formatMoney(totals.refunded_cents)} refunded`
              : `${totals.paid_count} paid`
          }
        />
        <Stat
          label="Outstanding"
          value={formatMoney(outstanding)}
          detail={`${unsettled} spot${unsettled === 1 ? "" : "s"} not settled`}
        />
        <Stat
          label="Unpaid"
          value={totals.unpaid_count}
          detail={
            totals.lapsed_count > 0
              ? `Plus ${totals.lapsed_count} lapsed hold${totals.lapsed_count === 1 ? "" : "s"}`
              : "No lapsed holds"
          }
        />
      </div>

      <div className="mb-6">
        <Section
          title="By trip"
          description="Live trips only. Filled counts paid spots plus holds still inside their payment window. The payment link is what members are sent; it is set on the trip."
        >
          <TableWrap>
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <Th>Trip</Th>
                  <Th>Payment link</Th>
                  <Th className="text-right">Filled</Th>
                  <Th className="text-right">Collected</Th>
                  <Th className="text-right">Expected</Th>
                  <Th className="text-right">Outstanding</Th>
                  <Th className="text-right">Paid</Th>
                  <Th className="text-right">Unpaid</Th>
                  <Th className="text-right">Lapsed</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byTrip.length === 0 ? (
                  <EmptyRow colSpan={9}>No live trips.</EmptyRow>
                ) : (
                  byTrip.map((trip) => (
                    <tr key={trip.trip_id} className="hover:bg-surface">
                      <Td>
                        <Link
                          href={`/admin/trips/${trip.trip_id}`}
                          className="font-medium hover:underline"
                        >
                          {trip.title}
                        </Link>
                        <span className="mt-0.5 block text-xs text-ink-faint">
                          Departs {at(trip.depart_at)}
                        </span>
                      </Td>
                      <Td>
                        <PaymentLink url={trip.payment_url} />
                      </Td>
                      <Td className="tnum whitespace-nowrap text-right text-ink-muted">
                        {trip.spots_filled}/{trip.capacity}
                      </Td>
                      <Td className="tnum whitespace-nowrap text-right">
                        {formatMoney(trip.collected_cents)}
                      </Td>
                      <Td className="tnum whitespace-nowrap text-right text-ink-muted">
                        {formatMoney(trip.expected_cents)}
                      </Td>
                      <Td className="tnum whitespace-nowrap text-right text-ink-muted">
                        {formatMoney(outstandingCents(trip))}
                      </Td>
                      <Td className="tnum text-right text-ink-muted">{trip.paid_count}</Td>
                      <Td className="tnum text-right text-ink-muted">{trip.unpaid_count}</Td>
                      <Td className="tnum text-right text-ink-muted">{trip.lapsed_count}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableWrap>
        </Section>
      </div>

      {mayManage ? (
        <div className="mb-6">
          <UnpaidMailer
            trips={byTrip.map((trip) => ({ id: trip.trip_id, title: trip.title }))}
            mailTripId={mailTripId}
            includeLapsed={includeLapsed}
            previewing={previewing}
            recipients={recipients}
          />
        </div>
      ) : null}

      <Section
        title={`${lines.length} signup${lines.length === 1 ? "" : "s"}`}
        description={
          allLines.length >= LINE_LIMIT
            ? `Showing the first ${LINE_LIMIT}. Filter by trip to narrow it down.`
            : "Everyone who owes money or has paid it, in trip and spot order."
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
            {filtered ? (
              <Link
                href="/admin/payments"
                className="text-xs text-ink-muted underline underline-offset-4 hover:text-ink"
              >
                Clear
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
                <Th>Email</Th>
                <Th>Trip</Th>
                <Th className="text-right">Spot</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
                <Th>Paid via</Th>
                <Th>Paid</Th>
                <Th>Deadline</Th>
                {mayManage ? <Th /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.length === 0 ? (
                <EmptyRow colSpan={mayManage ? 10 : 9}>
                  {filtered
                    ? "Nothing matches that filter."
                    : "Nobody has claimed a spot yet."}
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
    <Section
      title="Email unpaid members"
      description="One personalised message per member, each with their own payment link. Nobody sees anyone else's address."
    >
      <div className="space-y-4 px-5 py-4">
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
          Unpaid means a held spot with no payment recorded, using the same lazy expiry as the
          table below. Holds still inside their payment window are always included. A lapsed
          hold is past its deadline and its spot is queued for release, so asking for payment
          may be asking for a spot the member is about to lose - it is left out unless you tick
          the box. Trips whose results have not been released are skipped entirely: those
          members have not been told they have a spot yet.
        </p>

        {previewing ? (
          recipients.length === 0 ? (
            <Notice title="Nobody to email">
              No outstanding balances in that scope
              {includeLapsed ? "." : ", though there may be lapsed holds. Tick the box to include them."}{" "}
              Trips whose results are still unreleased never appear here.
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
                            <span className="ml-2 text-xs text-alert">lapsed</span>
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
    </Section>
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
  const canRecordPayment = state === "unpaid" || state === "lapsed";
  const canReinstate = REINSTATABLE_STATES.includes(state);
  const who = `${line.first_name} ${line.last_name}`;

  return (
    <tr className="hover:bg-surface">
      <Td className="whitespace-nowrap font-medium">
        {line.first_name} {line.last_name}
      </Td>
      <Td className="whitespace-nowrap text-ink-muted">{line.email}</Td>
      <Td className="whitespace-nowrap">
        <Link href={`/admin/trips/${line.trip_id}`} className="hover:underline">
          {line.trip_title}
        </Link>
      </Td>
      <Td className="tnum text-right">{line.spot_number ?? "-"}</Td>
      <Td className="tnum whitespace-nowrap text-right">
        {formatMoney(line.amount_cents)}
        {line.refunded_cents > 0 ? (
          <span className="mt-0.5 block text-xs text-ink-faint">
            {formatMoney(line.refunded_cents)} refunded
          </span>
        ) : null}
      </Td>
      <Td>
        <Badge emphasis={badgeEmphasis(state)}>{PAYMENT_STATE_LABELS[state]}</Badge>
      </Td>
      <Td>
        <span className={cn("whitespace-nowrap", via.label === "-" && "text-ink-faint")}>
          {via.label}
        </span>
        {via.note ? (
          <span className="mt-0.5 block text-xs text-ink-faint">{via.note}</span>
        ) : null}
      </Td>
      <Td className="whitespace-nowrap text-ink-muted">
        {line.paid_at ? at(line.paid_at) : "-"}
      </Td>
      <Td className="whitespace-nowrap text-ink-muted">
        {line.payment_deadline_at ? at(line.payment_deadline_at) : "-"}
      </Td>
      {mayManage ? (
        <Td>
          {canRecordPayment ? (
            <details className="min-w-56">
              <summary className="cursor-pointer text-xs text-accent underline underline-offset-4">
                Record payment
              </summary>
              <form action={recordPaymentAction} className="mt-2 space-y-1.5">
                <input type="hidden" name="signupId" value={line.signup_id} />
                <ProviderSelect who={who} />
                <Input
                  name="reference"
                  placeholder="Fusion transaction id"
                  aria-label={`Reference for the payment from ${who}`}
                  className="h-8 w-56 text-xs"
                />
                <div className="flex items-center gap-1.5">
                  <Input
                    name="note"
                    placeholder="Anything else worth recording"
                    aria-label={`Note about the payment from ${who}`}
                    className="h-8 w-44 text-xs"
                  />
                  <SubmitButton pendingLabel="Saving">Record</SubmitButton>
                </div>
                <p className="text-xs text-ink-faint">
                  Fusion needs its transaction id. Anything else needs a reference or a note.
                </p>
              </form>
            </details>
          ) : null}
          {canReinstate ? (
            <details className="min-w-56">
              <summary className="cursor-pointer text-xs text-accent underline underline-offset-4">
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
                <ProviderSelect who={who} />
                <Input
                  name="reference"
                  placeholder="Fusion transaction id"
                  aria-label={`Reference for the payment from ${who}, if there is one`}
                  className="h-8 w-56 text-xs"
                />
                <div className="flex items-center gap-1.5">
                  <Input
                    name="note"
                    placeholder="Anything else worth recording"
                    aria-label={`Note about the payment from ${who}, if there is one`}
                    className="h-8 w-44 text-xs"
                  />
                  <SubmitButton
                    pendingLabel="Reinstating"
                    confirm={`Put ${who} back on ${line.trip_title}? They take the lowest free spot and are emailed.`}
                  >
                    Reinstate
                  </SubmitButton>
                </div>
                <p className="text-xs text-ink-faint">
                  Leave the box clear to give them a fresh payment window; the payment fields
                  are then ignored.
                </p>
              </form>
            </details>
          ) : null}
        </Td>
      ) : null}
    </tr>
  );
}

/** Fusion is first and default: it is how the club is meant to bill. */
function ProviderSelect({ who }: { who: string }) {
  return (
    <select
      name="provider"
      defaultValue="fusion"
      aria-label={`How ${who} paid`}
      className="h-8 w-56 rounded-md border border-border bg-paper px-2 text-xs text-ink focus:border-accent focus:outline-none"
    >
      {PAYMENT_PROVIDERS.map((provider) => (
        <option key={provider} value={provider}>
          {PAYMENT_PROVIDER_LABELS[provider]}
        </option>
      ))}
    </select>
  );
}

/**
 * The Fusion link members are sent to. Shown in full rather than as the word
 * "link", because the treasurer's job here is to check that the link on the
 * trip is the one the Fusion portal is actually billing against.
 */
function PaymentLink({ url }: { url: string | null }) {
  if (!url) {
    return <span className="text-xs text-ink-faint">Not set</span>;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={url}
      className="block max-w-64 truncate text-xs text-accent underline underline-offset-4"
    >
      {url.replace(/^https?:\/\//, "")}
    </a>
  );
}

/** Paid is the settled state, so it reads heaviest; everything else is plain. */
function badgeEmphasis(state: PaymentState): "normal" | "strong" | "muted" {
  if (state === "paid") return "strong";
  if (state === "unpaid" || state === "lapsed") return "normal";
  return "muted";
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
