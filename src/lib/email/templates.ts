import type { EmailMessage } from "./send";

/**
 * EMAIL POLICY: this app sends email in exactly two situations, both of them a
 * board member's explicit click, and every template here belongs to one:
 *
 *   1. The roster release - `releaseResults` in lib/roster/results.ts, sent by
 *      "Release roster and notify".
 *   2. The treasurer's unpaid-riders batch on the payments page.
 *
 * Nothing else sends. Before adding a template, ask whether it belongs behind
 * one of those two buttons instead.
 */

const baseUrl = () => process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

const DENVER: Intl.DateTimeFormatOptions = {
  timeZone: "America/Denver",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

const when = (date: Date) => new Date(date).toLocaleString("en-US", DENVER);
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const message = (to: string, firstName: string, subject: string, body: string[]): EmailMessage => ({
  to,
  subject,
  text: [`${firstName},`, "", ...body].join("\n"),
});

/** One row of the roster release, as `releaseResults` selects it. */
export interface ResultRecipient {
  email: string;
  first_name: string;
  status: string;
  amount_cents: number;
  pay_token: string;
  payment_deadline_at: Date | null;
  trip_title: string;
}

/**
 * Send 1: the roster release, to riders on the trip only - the waitlist is not
 * emailed. The first time a rider is told anything beyond "entry received", so
 * it carries everything they need to act.
 */
export function resultEmail(row: ResultRecipient): EmailMessage {
  const statusPage = `${baseUrl()}/pay/${row.pay_token}`;

  // Marked paid before release. Demanding money by a deadline here would read
  // as the club having lost their payment.
  if (row.status === "paid") {
    return message(row.email, row.first_name, `You are on ${row.trip_title}`, [
      `The roster for ${row.trip_title} is out, and you are on the trip. Your`,
      "payment is already recorded, so there is nothing to pay and nothing",
      "more to do.",
      "",
      `Your status page: ${statusPage}`,
    ]);
  }

  return message(row.email, row.first_name, `You are on ${row.trip_title}`, [
    `The roster for ${row.trip_title} is out, and you are on the trip.`,
    "",
    `Amount: ${money(row.amount_cents)}`,
    `Due by: ${when(row.payment_deadline_at ?? new Date())}`,
    "",
    `Pay here: ${statusPage}`,
    "",
    "Your spot is not confirmed until payment is received. If the deadline",
    "passes without payment, it goes to someone on the waitlist.",
    "",
    "The treasurer records payments by hand, so the site can take a few days",
    "to show yours as paid. That is normal - you do not need to pay twice.",
  ]);
}

/**
 * Send 2: the treasurer's unpaid-riders batch. States the deadline outright,
 * and says plainly when it has already passed.
 */
export function outstandingBalanceEmail(params: {
  to: string;
  firstName: string;
  tripTitle: string;
  amountCents: number;
  deadline: Date;
  payToken: string;
  lapsed: boolean;
}): EmailMessage {
  const tail = params.lapsed
    ? [
        "This deadline has already passed, so the spot may go to someone on the",
        "waitlist at any time. Pay now or reply to this email if you no longer",
        "want to go.",
      ]
    : [
        "If payment is not received by the deadline, the spot may go to someone",
        "on the waitlist.",
      ];

  return message(params.to, params.firstName, `Outstanding balance for ${params.tripTitle}`, [
    `The club has not recorded payment for your spot on ${params.tripTitle}.`,
    "",
    `Amount owed: ${money(params.amountCents)}`,
    `Due by: ${when(params.deadline)}`,
    "",
    `Pay here: ${baseUrl()}/pay/${params.payToken}`,
    "",
    ...tail,
    "",
    "The treasurer records payments by hand, so a payment from the last few",
    "days may not show yet. If you have already paid by cash, Venmo, or",
    "through the university, reply to this email so it can be recorded.",
  ]);
}
