"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/admin/submit-button";
import { Field, Input, Notice } from "@/components/ui";
import { saveSponsor, type SponsorFormState } from "./actions";

export function SponsorForm({
  sponsor,
  submitLabel,
}: {
  sponsor?: { id: string; name: string; websiteUrl: string | null; description: string | null };
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<SponsorFormState, FormData>(saveSponsor, {});

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <Notice tone="alert" title="Not saved">
          {state.error}
        </Notice>
      ) : null}
      {sponsor ? <input type="hidden" name="sponsorId" value={sponsor.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input name="name" required maxLength={120} defaultValue={sponsor?.name} />
        </Field>
        <Field label="Website">
          <Input
            name="websiteUrl"
            inputMode="url"
            maxLength={300}
            defaultValue={sponsor?.websiteUrl ?? ""}
          />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          name="description"
          rows={2}
          maxLength={500}
          defaultValue={sponsor?.description ?? ""}
          className="w-full rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </Field>

      <SubmitButton variant="primary" pendingLabel="Saving" className="h-10 px-4 text-sm">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
