import type { EmailMessage } from "./send";

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

export function paymentReminderEmail(params: {
  to: string;
  firstName: string;
  tripTitle: string;
  amountCents: number;
  deadline: Date;
  payToken: string;
  hoursLeft: number;
}): EmailMessage {
  const link = `${baseUrl()}/pay/${params.payToken}`;
  return {
    to: params.to,
    subject: `Payment due for ${params.tripTitle} (${params.hoursLeft}h left)`,
    text: [
      `${params.firstName},`,
      "",
      `Your spot on ${params.tripTitle} is held but not yet paid.`,
      "",
      `Amount: ${money(params.amountCents)}`,
      `Due by: ${when(params.deadline)}`,
      "",
      `Pay here: ${link}`,
      "",
      "If payment is not received by the deadline, the spot is released and",
      "offered to the waitlist.",
    ].join("\n"),
  };
}

export function holdExpiredEmail(params: {
  to: string;
  firstName: string;
  tripTitle: string;
}): EmailMessage {
  return {
    to: params.to,
    subject: `Your spot on ${params.tripTitle} was released`,
    text: [
      `${params.firstName},`,
      "",
      `The payment deadline for ${params.tripTitle} passed, so your spot has`,
      "been released and offered to the waitlist.",
      "",
      "If you still want to go, reply to this email or reach out to the travel",
      "coordinator - if the trip has not filled you may be able to get back on.",
    ].join("\n"),
  };
}

export function promotedEmail(params: {
  to: string;
  firstName: string;
  tripTitle: string;
  spotNumber: number;
  amountCents: number;
  deadline: Date;
  payToken: string;
}): EmailMessage {
  const link = `${baseUrl()}/pay/${params.payToken}`;
  return {
    to: params.to,
    subject: `You are off the waitlist for ${params.tripTitle}`,
    text: [
      `${params.firstName},`,
      "",
      `A spot opened up on ${params.tripTitle} and you are next on the waitlist.`,
      `You now have spot ${params.spotNumber}.`,
      "",
      `Amount: ${money(params.amountCents)}`,
      `Due by: ${when(params.deadline)}`,
      "",
      `Pay here: ${link}`,
      "",
      "The spot is not confirmed until payment is received, and it is released",
      "again if the deadline passes.",
    ].join("\n"),
  };
}

/**
 * Sent before a drop so members can re-arm their verification cookie on
 * whatever device they will actually be holding at signup time.
 */
export function readyForDropEmail(params: {
  to: string;
  firstName: string;
  tripTitle: string;
  opensAt: Date;
  readyToken: string;
  tripSlug: string;
}): EmailMessage {
  const link = `${baseUrl()}/ready?t=${params.readyToken}&next=/trips/${params.tripSlug}`;
  return {
    to: params.to,
    subject: `Signups for ${params.tripTitle} open ${when(params.opensAt)}`,
    text: [
      `${params.firstName},`,
      "",
      `Signups for ${params.tripTitle} open at ${when(params.opensAt)}.`,
      "",
      "You are verified. Open this link on the device you will actually be using",
      "at signup time, so the claim button is armed and ready:",
      "",
      link,
      "",
      "Spots are given out in the order requests reach the server. Claiming is a",
      "single click - there is no code to enter.",
    ].join("\n"),
  };
}

/**
 * The one alert nobody may ignore: money arrived for a spot that had already
 * been released. Until a human reinstates the rider or refunds them, the club
 * is holding funds against nothing.
 */
export function paymentNeedsReviewEmail(params: {
  to: string;
  memberName: string;
  tripTitle: string;
  amountCents: number;
  signupStatus: string;
  tripId: string;
}): EmailMessage {
  return {
    to: params.to,
    subject: `Action needed: payment received after hold expired (${params.tripTitle})`,
    text: [
      `${params.memberName} paid ${money(params.amountCents)} for ${params.tripTitle},`,
      `but their spot was already ${params.signupStatus} when the payment landed.`,
      "",
      "The club is currently holding money for a spot that is not allocated.",
      "Someone needs to either put them back on the trip or refund them.",
      "",
      `Review: ${baseUrl()}/admin/trips/${params.tripId}`,
    ].join("\n"),
  };
}

/**
 * Sent when the board puts a released rider back on a trip. Two shapes, because
 * the two cases mean opposite things to the reader: either the money already
 * arrived and there is nothing to do, or a fresh payment deadline is now running
 * against a spot they had written off.
 */
export function reinstatedEmail(params: {
  to: string;
  firstName: string;
  tripTitle: string;
  spotNumber: number;
  amountCents: number;
  payToken: string;
  deadline: Date;
  alreadyPaid: boolean;
}): EmailMessage {
  const link = `${baseUrl()}/pay/${params.payToken}`;

  const body = params.alreadyPaid
    ? [
        `Your payment of ${money(params.amountCents)} has been applied and your`,
        "spot is confirmed. Nothing further is needed.",
        "",
        `Your details: ${link}`,
      ]
    : [
        `Amount: ${money(params.amountCents)}`,
        `Due by: ${when(params.deadline)}`,
        "",
        `Pay here: ${link}`,
        "",
        "The spot is not confirmed until payment is received, and it is released",
        "again if this new deadline passes.",
      ];

  return {
    to: params.to,
    subject: `You are back on ${params.tripTitle}`,
    text: [
      `${params.firstName},`,
      "",
      `The board has put you back on ${params.tripTitle}. You have spot ${params.spotNumber}.`,
      "",
      ...body,
    ].join("\n"),
  };
}

/**
 * The treasurer chasing an outstanding balance. Close kin of
 * paymentReminderEmail, but sent in a batch rather than off a countdown, so it
 * states the deadline outright instead of an hours-remaining figure, and says
 * plainly when the deadline has already passed.
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
  const link = `${baseUrl()}/pay/${params.payToken}`;

  const tail = params.lapsed
    ? [
        "This deadline has already passed, so the spot may be released to the",
        "waitlist at any time. Pay now or reply to this email if you no longer",
        "want to go.",
      ]
    : [
        "If payment is not received by the deadline, the spot is released and",
        "offered to the waitlist.",
      ];

  return {
    to: params.to,
    subject: `Outstanding balance for ${params.tripTitle}`,
    text: [
      `${params.firstName},`,
      "",
      `The club has not recorded payment for your spot on ${params.tripTitle}.`,
      "",
      `Amount owed: ${money(params.amountCents)}`,
      `Due by: ${when(params.deadline)}`,
      "",
      `Pay here: ${link}`,
      "",
      ...tail,
      "",
      "If you have already paid by cash, Venmo, or through the university,",
      "reply to this email so the treasurer can record it.",
    ].join("\n"),
  };
}

export function spotsOpenedEmail(params: {
  to: string;
  tripTitle: string;
  tripId: string;
  freedCount: number;
  waitlistDepth: number;
}): EmailMessage {
  const link = `${baseUrl()}/admin/trips/${params.tripId}`;
  return {
    to: params.to,
    subject: `${params.tripTitle}: ${params.freedCount} spot(s) opened`,
    text: [
      `${params.freedCount} unpaid hold(s) on ${params.tripTitle} lapsed and were released.`,
      `${params.waitlistDepth} member(s) are on the waitlist.`,
      "",
      `Promote from the waitlist here: ${link}`,
    ].join("\n"),
  };
}
