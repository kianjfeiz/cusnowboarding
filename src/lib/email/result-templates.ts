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

/**
 * Sent when the board releases results. This is the first time a member is told
 * anything beyond "entry received", so it has to carry everything they need to
 * act, and the payment clock starts from here rather than from when they typed.
 */
export function gotASpotEmail(params: {
  to: string;
  firstName: string;
  tripTitle: string;
  spotNumber: number;
  amountCents: number;
  deadline: Date;
  payToken: string;
}): EmailMessage {
  return {
    to: params.to,
    subject: `You are on ${params.tripTitle}`,
    text: [
      `${params.firstName},`,
      "",
      `You have a spot on ${params.tripTitle}.`,
      "",
      `Amount: ${money(params.amountCents)}`,
      `Due by: ${when(params.deadline)}`,
      "",
      `Pay here: ${baseUrl()}/pay/${params.payToken}`,
      "",
      "Your spot is not confirmed until payment is received. If the deadline",
      "passes without payment, it goes to someone on the waitlist.",
    ].join("\n"),
  };
}

/**
 * Deliberately does not state a waitlist position.
 *
 * The board picks from the waitlist rather than promoting strictly in order, so
 * a number would be misleading - someone told they are "number 3" would
 * reasonably expect to go before number 4, and that is not how the decision is
 * made. Saying only that they are on it is the honest version.
 */
export function waitlistedEmail(params: {
  to: string;
  firstName: string;
  tripTitle: string;
}): EmailMessage {
  return {
    to: params.to,
    subject: `You are on the waitlist for ${params.tripTitle}`,
    text: [
      `${params.firstName},`,
      "",
      `${params.tripTitle} filled up, so you are on the waitlist.`,
      "",
      "Spots do open up - people drop and holds go unpaid - and the trip",
      "coordinators pull from the waitlist when they do. If you get a spot you",
      "will get an email with a payment link.",
      "",
      `You can check any time at ${baseUrl()}/me`,
    ].join("\n"),
  };
}
