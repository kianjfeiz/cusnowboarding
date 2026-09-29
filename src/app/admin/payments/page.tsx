import Link from "next/link";
import type { ReactNode } from "react";
import { DataTable, PageHeader, Section, Stat, Td } from "@/components/admin/shell";
import { SubmitButton } from "@/components/admin/submit-button";
import { Badge, Button, Notice, formatDenver, formatMoney } from "@/components/ui";
import { can } from "@/lib/auth/authz";
import { clubPaymentUrl } from "@/lib/money/payments";
import { requireCapability } from "../_lib/actor";
import {
  PAYMENT_STATE_LABELS,
  getPaymentTotals,
  isOwing,
  listPaymentLines,
  listPaymentTrips,
  paidVia,
  paymentState,
  resolveTripId,
  type PaymentLine,
  type PaymentState,
  type PaymentTrip,
} from "../_lib/payment-queries";
import { recordPaymentAction, reinstateSignupAction, sendUnpaidRemindersAction } from "./actions";
import { BulkMarkPaid } from "./bulk-mark-paid";
import { MARK_PAID_FORM } from "./mark-paid-form";
import { PaymentSourceFields } from "./payment-source-fields";
import { MAX_BATCH, listUnpaidRecipients, type UnpaidRecipient } from "./unpaid";

export const dynamic = "force-dynamic";

/** The table carries a lot of timestamps; the zone is stated once, in the header. */
const at = (value: Date | string) => formatDenver(value, { timeZoneName: undefined });

/** Statuses a signup can be put back from. Mirrors lib/roster/reinstate.ts. */
const REINSTATABLE_STATES: PaymentState[] = ["released", "cancelled", "refunded"];

const FILTERS = [
  { id: "owing", title: "Owing" },
  { id: "paid", title: "Paid" },
  { id: "all", title: "Everyone" },
];

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
  // Opens on what the treasurer came for: the people who still owe money.
  const filter = params.status === "paid" || params.status === "all" ? params.status : "owing";

  const trips = await listPaymentTrips();
  const tripId = resolveTripId(params.trip, trips);
  // Soonest departure first, for the reminder scope and the missing-link notice.
  const liveTrips = trips.filter((trip) => trip.is_live).reverse();

  const [totals, allLines] = await Promise.all([getPaymentTotals(), listPaymentLines(tripId)]);

  const now = Date.now();
  const lines = allLines.filter((line) => {
    if (filter === "all") return true;
    const state = paymentState(line, now);
    return filter === "paid" ? state === "paid" : isOwing(state);
  });
  // A trip without its own link falls back to the club-wide one, so it only
  // leaves members stranded when that is missing too.
  const noLink = clubPaymentUrl() ? [] : liveTrips.filter((trip) => !trip.payment_url);

  // The batch reminder has its own scope, kept separate from the table filters
  // so that narrowing the table cannot silently change who gets mailed.
  const mailTripId = resolveTripId(params.mailTrip, liveTrips);
  const includeLapsed = params.mailLapsed === "1";
  const previewing = mayManage && params.mailPreview === "1";
  const recipients = previewing ? await listUnpaidRecipients(mailTripId, includeLapsed, now) : [];

  // Ticking rows off against the Fusion export is the common case, so owing rows
  // get checkboxes and a batch button.
  const batch = mayManage && lines.some((line) => isOwing(paymentState(line, now)));

  const sent = params.mailSent === undefined ? null : Number(params.mailSent) || 0;
  const failed = Number(params.mailFailed) || 0;

  return (
    <>
      <PageHeader
        title="Payments"
        actions={
          mayManage ? (
            // Reconciliation is done against the whole ledger, so the export
            // follows the chosen trip but never the status filter.
            <a
              href={`/admin/payments/reconciliation.csv${tripId ? `?trip=${tripId}` : ""}`}
              className="inline-flex h-10 items-center rounded-md border border-border-strong px-3 text-xs font-medium hover:bg-surface sm:h-8"
            >
              Reconciliation CSV
            </a>
          ) : null
        }
      />

      {sent !== null ? (
        <div className="mb-6">
          <Notice
            tone={failed > 0 ? "alert" : "accent"}
            title={`${sent} reminder${sent === 1 ? "" : "s"} sent`}
          >
            {failed > 0
              ? `${failed} could not be delivered and were not retried. The addresses are in the audit log; chase those members individually rather than resending the batch.`
              : "Each member was emailed separately."}
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
          value={formatMoney(totals.outstanding_cents)}
          detail={`${totals.unpaid_count} unpaid, ${totals.lapsed_count} lapsed`}
        />
        <Stat
          label="Collected"
          value={formatMoney(totals.collected_cents)}
          detail={`${totals.paid_count} paid`}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Section
          title={
            filter === "all"
              ? `${lines.length} signup${lines.length === 1 ? "" : "s"}`
              : `${lines.length} ${filter}`
          }
          actions={
            <form method="get" className="flex flex-wrap items-center gap-2">
              <FilterSelect name="status" label="Status" value={filter} options={FILTERS} />
              <FilterSelect
                name="trip"
                label="Trip"
                value={tripId}
                all="All trips"
                options={trips}
              />
              <Button type="submit" variant="secondary" className="h-8 px-3 text-xs">
                Apply
              </Button>
              {params.status !== undefined || tripId !== null ? (
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
          {batch ? (
            <>
              {/* Empty on purpose: the row checkboxes and Mark paid buttons join
                  it through their form attribute, so no form wraps the table. */}
              <form id={MARK_PAID_FORM} action={recordPaymentAction} />
              <BulkMarkPaid />
            </>
          ) : null}
          <DataTable
            columns={[
              ...(batch ? [""] : []),
              "Member",
              "Trip",
              ["Amount", "text-right"],
              "Status",
              ...(mayManage ? [""] : []),
            ]}
            empty={
              filter === "owing" ? "Nobody owes the club money." : "Nothing matches that filter."
            }
          >
            {lines.map((line) => (
              <PaymentRow
                key={line.signup_id}
                line={line}
                now={now}
                mayManage={mayManage}
                batch={batch}
              />
            ))}
          </DataTable>
        </Section>

        {mayManage ? (
          <UnpaidMailer
            trips={liveTrips}
            mailTripId={mailTripId}
            includeLapsed={includeLapsed}
            previewing={previewing}
            recipients={recipients}
          />
        ) : null}
      </div>
    </>
  );
}

/**
 * Batch reminder to everyone with an outstanding balance.
 *
 * Deliberately two steps. The first is a plain GET that only re-renders the
 * page with the recipient list resolved; nothing is sent. Only the second form,
 * which carries the count the treasurer actually read, can send: contacting
 * forty members is not something a mis-click should do, and a bare count is not
 * enough to confirm against - the names have to be on screen.
 */
function UnpaidMailer({
  trips,
  mailTripId,
  includeLapsed,
  previewing,
  recipients,
}: {
  trips: PaymentTrip[];
  mailTripId: string | null;
  includeLapsed: boolean;
  previewing: boolean;
  recipients: UnpaidRecipient[];
}) {
  const count = recipients.length;
  const plural = count === 1 ? "" : "s";
  const total = recipients.reduce((sum, row) => sum + row.amount_cents, 0);

  return (
    <Section title="Email who owes" description="One email each, with their own payment link.">
      <div className="space-y-4 px-5 py-4">
        <form method="get" className="space-y-3">
          <input type="hidden" name="mailPreview" value="1" />
          <FilterSelect
            name="mailTrip"
            label="Trip"
            value={mailTripId}
            all="All released trips"
            options={trips}
            wide
          />
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
          <Button type="submit" variant="secondary" className="h-8 w-full px-3 text-xs">
            {previewing ? "Update list" : "Preview recipients"}
          </Button>
        </form>

        {!previewing ? null : count === 0 ? (
          <p className="text-sm text-ink-muted">Nobody owes money in that scope.</p>
        ) : (
          <div className="space-y-3">
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {recipients.map((row) => (
                <li
                  key={row.signup_id}
                  className="flex items-baseline justify-between gap-3 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">
                      {row.first_name} {row.last_name}
                    </span>
                    <span className="block truncate text-xs text-ink-faint">
                      {row.trip_title}
                      {row.lapsed ? " · lapsed" : ""}
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-sm">{formatMoney(row.amount_cents)}</span>
                </li>
              ))}
            </ul>

            <p className="text-xs text-ink-muted">
              <span className="tnum font-medium text-ink">{count}</span> recipient{plural},{" "}
              {formatMoney(total)} outstanding.
            </p>

            {count > MAX_BATCH ? (
              <Notice tone="alert" title="Too many at once">
                More than {MAX_BATCH} members. Send one trip at a time.
              </Notice>
            ) : (
              <form action={sendUnpaidRemindersAction}>
                <input type="hidden" name="tripId" value={mailTripId ?? ""} />
                {includeLapsed ? <input type="hidden" name="includeLapsed" value="1" /> : null}
                {/* Re-checked on the server: a list that moved since this
                    page rendered is refused rather than quietly widened. */}
                <input type="hidden" name="expectedCount" value={count} />
                <SubmitButton
                  variant="primary"
                  pendingLabel="Sending"
                  confirm={`Send ${count} separate email${plural}, one per member. This cannot be undone.`}
                  className="h-10 w-full text-sm"
                >
                  {`Send ${count} email${plural}`}
                </SubmitButton>
              </form>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

function PaymentRow({
  line,
  now,
  mayManage,
  batch,
}: {
  line: PaymentLine;
  now: number;
  mayManage: boolean;
  batch: boolean;
}) {
  const state = paymentState(line, now);
  const via = paidVia(line);
  const owing = isOwing(state);
  const who = `${line.first_name} ${line.last_name}`;

  return (
    <tr className="hover:bg-surface">
      {batch ? (
        <Td className="w-8">
          {owing ? (
            <input
              type="checkbox"
              name="signupIds"
              value={line.signup_id}
              form={MARK_PAID_FORM}
              aria-label={`Select ${who}`}
              className="h-4 w-4 accent-accent"
            />
          ) : null}
        </Td>
      ) : null}
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
        <span className="mt-0.5 block text-xs text-ink-faint">
          {owing && line.payment_deadline_at
            ? `Due ${at(line.payment_deadline_at)}`
            : via.label !== "-"
              ? [via.label, via.note, line.paid_at ? at(line.paid_at) : null]
                  .filter(Boolean)
                  .join(" · ")
              : null}
        </span>
      </Td>
      {mayManage ? (
        <Td className="whitespace-nowrap">
          {owing ? (
            <div className="flex items-center justify-end gap-1">
              <SubmitButton
                form={MARK_PAID_FORM}
                name="only"
                value={line.signup_id}
                confirm={`Mark ${who} paid through Fusion?`}
              >
                Mark paid
              </SubmitButton>
              <RowPopover
                id={`other-${line.signup_id}`}
                label="Other"
                title={`Mark ${who} paid`}
                detail={`${line.trip_title} · ${formatMoney(line.amount_cents)}`}
              >
                <form action={recordPaymentAction}>
                  <input type="hidden" name="only" value={line.signup_id} />
                  <PaymentSourceFields
                    who={who}
                    providers={["venmo", "cash", "check", "other"]}
                    buttons={
                      <>
                        <SubmitButton pendingLabel="Saving">Mark paid</SubmitButton>
                        <PopoverClose id={`other-${line.signup_id}`} />
                      </>
                    }
                  />
                </form>
              </RowPopover>
            </div>
          ) : null}
          {REINSTATABLE_STATES.includes(state) ? (
            <div className="flex justify-end">
              <RowPopover
                id={`reinstate-${line.signup_id}`}
                label="Reinstate"
                title={`Put ${who} back on the trip`}
                detail={`${line.trip_title} · They are not emailed, so tell them.`}
              >
                <form action={reinstateSignupAction} className="space-y-3">
                  <input type="hidden" name="signupId" value={line.signup_id} />
                  <label className="flex items-center gap-2 text-sm text-ink-muted">
                    <input
                      type="checkbox"
                      name="markPaid"
                      value="1"
                      className="h-4 w-4 accent-accent"
                    />
                    <span>Money already received</span>
                  </label>
                  <PaymentSourceFields
                    who={who}
                    buttons={
                      <>
                        <SubmitButton pendingLabel="Reinstating">Reinstate</SubmitButton>
                        <PopoverClose id={`reinstate-${line.signup_id}`} />
                      </>
                    }
                  />
                </form>
              </RowPopover>
            </div>
          ) : null}
        </Td>
      ) : null}
    </tr>
  );
}

/**
 * The exception paths open over the page rather than inside the row: a form
 * unfolding in a table cell stretches the row and runs off the table's edge.
 * A native popover, so Escape and a click outside close it without a script.
 */
function RowPopover({
  id,
  label,
  title,
  detail,
  children,
}: {
  id: string;
  label: string;
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        className="inline-flex h-10 items-center rounded-md px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:h-8"
      >
        {label}
      </button>
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        className="m-auto w-[min(22rem,calc(100vw-2rem))] whitespace-normal rounded-lg border border-border bg-paper p-5 text-left text-ink backdrop:bg-ink/40"
      >
        <h2 id={`${id}-title`} className="font-semibold">
          {title}
        </h2>
        <p className="mb-4 mt-0.5 text-sm text-ink-muted">{detail}</p>
        {children}
      </div>
    </>
  );
}

function PopoverClose({ id }: { id: string }) {
  return (
    <button
      type="button"
      popoverTarget={id}
      popoverTargetAction="hide"
      className="inline-flex h-10 items-center rounded-md px-4 text-sm font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink"
    >
      Cancel
    </button>
  );
}

/** `all` adds the unfiltered choice ahead of the options. */
function FilterSelect({
  name,
  label,
  value,
  all,
  options,
  wide,
}: {
  name: string;
  label: string;
  value: string | null;
  all?: string;
  options: Array<{ id: string; title: string }>;
  /** Fills its container instead of capping at a filter-bar width. */
  wide?: boolean;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-muted">
      <span>{label}</span>
      <select
        name={name}
        defaultValue={value ?? ""}
        className={`h-8 rounded-md border border-border bg-paper px-2 text-xs text-ink focus:border-accent focus:outline-none ${
          wide ? "min-w-0 flex-1" : "max-w-48"
        }`}
      >
        {all ? <option value="">{all}</option> : null}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.title}
          </option>
        ))}
      </select>
    </label>
  );
}
