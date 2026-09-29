/**
 * How the money arrived. Deliberately free of database imports, so the
 * treasurer's forms and the server share one vocabulary.
 *
 * The `provider` column is plain text, so this list is the only thing keeping
 * it to a set worth grouping by.
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
