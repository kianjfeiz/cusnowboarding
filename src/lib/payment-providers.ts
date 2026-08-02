/**
 * How the money arrived, and what evidence that leaves behind.
 *
 * This is deliberately free of database imports: the treasurer's form is a
 * client component, and it needs the same vocabulary and the same
 * reference rule the server enforces. Keeping both on one definition is the
 * point - a form that asks for a Fusion transaction id while Cash is selected
 * is how the previous version read.
 */

/**
 * The `provider` column is plain text, so this list is the only thing keeping it
 * to a set worth grouping by. `fusion` is the default because it is how the club
 * is supposed to bill; the rest exist because members hand over cash at meetings
 * and the treasurer still has to be able to say so.
 */
export const PAYMENT_PROVIDERS = ["fusion", "venmo", "cash", "check", "other"] as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_PROVIDER_LABELS: Record<PaymentProvider, string> = {
  fusion: "Fusion",
  venmo: "Venmo",
  cash: "Cash",
  check: "Check",
  other: "Other",
};

export function parsePaymentProvider(raw: string | null | undefined): PaymentProvider {
  const found = PAYMENT_PROVIDERS.find((value) => value === raw);
  return found ?? "fusion";
}

/**
 * Only Fusion has a reference the club can be held to.
 *
 * The transaction id is the one thing tying a row here to a line in the Fusion
 * export, so recording a Fusion payment without it makes the reconciliation
 * impossible later. Cash across a table has no equivalent, so for every other
 * provider a free-text note stands in - one or the other, never neither. That
 * second half is not this function's job; see `recordPayment`.
 */
export function requiresReference(provider: PaymentProvider): boolean {
  return provider === "fusion";
}

/**
 * What to call the reference field, given how the money came in. Asking for a
 * "Fusion transaction id" when the treasurer picked Cash reads as a required
 * field they cannot satisfy.
 */
export const REFERENCE_PLACEHOLDER: Record<PaymentProvider, string> = {
  fusion: "Fusion transaction id",
  venmo: "Venmo handle or note",
  cash: "Reference, if there is one",
  check: "Check number",
  other: "Reference, if there is one",
};
