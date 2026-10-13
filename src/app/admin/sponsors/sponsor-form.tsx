"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button, Field, Input, Notice } from "@/components/ui";
import { saveSponsor, type SponsorFormState } from "./actions";

type SponsorFields = { name: string; websiteUrl: string; description: string };

/**
 * React resets a form after every action, including one the server rejected,
 * so a rejection carries back what was typed for the reset to restore.
 */
type FormState = SponsorFormState & { values?: SponsorFields };

/** Creates a sponsor, or edits one in place when given `sponsor`. */
export function SponsorForm({
  sponsor,
  submitLabel,
  onDone,
  onCancel,
}: {
  sponsor?: { id: string; name: string; websiteUrl: string | null; description: string | null };
  submitLabel: string;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(async (prev, formData) => {
    const next = await saveSponsor(prev, formData);
    if (!next.error) {
      onDone?.();
      return next;
    }
    const field = (key: keyof SponsorFields) => String(formData.get(key) ?? "");
    return {
      ...next,
      values: {
        name: field("name"),
        websiteUrl: field("websiteUrl"),
        description: field("description"),
      },
    };
  }, {});
  const values = state.values;

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
          <Input
            name="name"
            required
            maxLength={120}
            defaultValue={values?.name ?? sponsor?.name}
            autoFocus
          />
        </Field>
        <Field label="Website">
          <Input
            name="websiteUrl"
            inputMode="url"
            maxLength={300}
            placeholder="burton.com"
            defaultValue={values?.websiteUrl ?? sponsor?.websiteUrl ?? ""}
          />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          name="description"
          rows={3}
          maxLength={500}
          defaultValue={values?.description ?? sponsor?.description ?? ""}
          className="w-full rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton variant="primary" pendingLabel="Saving" className="h-9 px-4 text-sm">
          {submitLabel}
        </SubmitButton>
        {onCancel ? (
          <Button type="button" variant="quiet" className="h-9 px-3 text-sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
