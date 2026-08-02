"use client";

import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui";
import {
  PAYMENT_PROVIDERS,
  PAYMENT_PROVIDER_LABELS,
  REFERENCE_PLACEHOLDER,
  requiresReference,
  type PaymentProvider,
} from "@/lib/payment-providers";

/**
 * The provider-dependent half of the treasurer's forms: how the money arrived,
 * the reference that proves it, and the note that stands in when there is no
 * reference to give.
 *
 * These are one component because the reference field cannot be labelled
 * without knowing the provider. Rendered statically it always read "Fusion
 * transaction id", which made the field look mandatory for a payment handed
 * over in cash - the server never required it there, but nothing on screen
 * said so.
 *
 * The server is still the gate. `recordPayment` re-checks both halves of the
 * rule, so a treasurer who defeats the browser's own validation gets an error
 * rather than an unreconcilable row.
 */
export function PaymentSourceFields({
  who,
  fusionNeedsReference,
  submit,
  hint,
}: {
  who: string;
  /**
   * True when recording a payment: Fusion's transaction id is mandatory there.
   * False when reinstating, where the money may not have arrived at all and the
   * payment fields are ignored unless the box is ticked.
   */
  fusionNeedsReference: boolean;
  submit: ReactNode;
  hint?: ReactNode;
}) {
  const [provider, setProvider] = useState<PaymentProvider>("fusion");
  const referenceRequired = fusionNeedsReference && requiresReference(provider);

  return (
    <>
      {/* Fusion is first and default: it is how the club is meant to bill. */}
      <select
        name="provider"
        value={provider}
        onChange={(event) => setProvider(event.target.value as PaymentProvider)}
        aria-label={`How ${who} paid`}
        className="h-8 w-56 rounded-md border border-border bg-paper px-2 text-xs text-ink focus:border-accent focus:outline-none"
      >
        {PAYMENT_PROVIDERS.map((value) => (
          <option key={value} value={value}>
            {PAYMENT_PROVIDER_LABELS[value]}
          </option>
        ))}
      </select>

      <Input
        name="reference"
        required={referenceRequired}
        placeholder={REFERENCE_PLACEHOLDER[provider]}
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
        {submit}
      </div>

      <p className="text-xs text-ink-faint">
        {fusionNeedsReference
          ? referenceRequired
            ? "Fusion needs its transaction id - it is the only thing tying this to a line in the export."
            : "Add a reference or a note saying where the money came from."
          : null}
        {hint ? <> {hint}</> : null}
      </p>
    </>
  );
}
