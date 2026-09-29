import type { ReactNode } from "react";
import { Input } from "@/components/ui";
import {
  PAYMENT_PROVIDERS,
  PAYMENT_PROVIDER_LABELS,
  type PaymentProvider,
} from "@/lib/money/payment-providers";

/** How the money came in and an optional note, stacked above the buttons. */
export function PaymentSourceFields({
  who,
  providers = PAYMENT_PROVIDERS,
  buttons,
}: {
  who: string;
  /** The first is the default. */
  providers?: readonly PaymentProvider[];
  buttons: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs text-ink-muted">How they paid</span>
        <select
          name="provider"
          defaultValue={providers[0]}
          aria-label={`How ${who} paid`}
          className="mt-1 h-10 w-full rounded-md border border-border bg-paper px-3 text-sm text-ink focus:border-accent focus:outline-none"
        >
          {providers.map((value) => (
            <option key={value} value={value}>
              {PAYMENT_PROVIDER_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs text-ink-muted">Note (optional)</span>
        <Input name="note" aria-label={`Note about the payment from ${who}`} className="mt-1" />
      </label>
      <div className="flex items-center gap-2 pt-1">{buttons}</div>
    </div>
  );
}
