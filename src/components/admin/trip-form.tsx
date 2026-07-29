"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { TripFormState } from "@/app/admin/trips/actions";
import { Button, Field, Input, Notice } from "@/components/ui";

export interface TripFormDefaults {
  id?: string;
  title: string;
  slug: string;
  resort: string;
  description: string;
  departAt: string;
  returnAt: string;
  signupOpensAt: string;
  signupClosesAt: string;
  priceDollars: string;
  capacity: string;
  waitlistCap: string;
  paymentWindowHours: string;
  requiresDues: boolean;
  paymentUrl: string | null;
}

const inputClass =
  "w-full rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";

export function TripForm({
  action,
  defaults,
  submitLabel,
  cancelHref,
}: {
  action: (state: TripFormState, formData: FormData) => Promise<TripFormState>;
  defaults: TripFormDefaults;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<TripFormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-8">
      {defaults.id ? <input type="hidden" name="tripId" value={defaults.id} /> : null}

      {state.error ? (
        <Notice tone="alert" title="Not saved">
          {state.error}
        </Notice>
      ) : null}

      <section className="space-y-5 rounded-lg border border-border bg-paper p-6">
        <h2 className="text-sm font-semibold">The trip</h2>

        <Field label="Title">
          <Input name="title" defaultValue={defaults.title} required maxLength={120} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Resort">
            <Input name="resort" defaultValue={defaults.resort} maxLength={80} />
          </Field>
          <Field label="URL slug" hint="Leave blank to derive it from the title.">
            <Input name="slug" defaultValue={defaults.slug} maxLength={80} />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Departs" hint="Mountain Time">
            <Input
              type="datetime-local"
              name="departAt"
              defaultValue={defaults.departAt}
              required
            />
          </Field>
          <Field label="Returns" hint="Mountain Time. Optional for a day trip.">
            <Input type="datetime-local" name="returnAt" defaultValue={defaults.returnAt} />
          </Field>
        </div>

        <Field label="Description" hint="Shown on the public trip page.">
          <textarea
            name="description"
            rows={4}
            defaultValue={defaults.description}
            className={inputClass}
          />
        </Field>
      </section>

      <section className="space-y-5 rounded-lg border border-border bg-paper p-6">
        <h2 className="text-sm font-semibold">Spots and money</h2>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Price" hint="Dollars, stored as cents.">
            <Input
              type="number"
              name="priceDollars"
              step="0.01"
              min="0"
              defaultValue={defaults.priceDollars}
              required
            />
          </Field>
          <Field label="Capacity">
            <Input
              type="number"
              name="capacity"
              min="1"
              step="1"
              defaultValue={defaults.capacity}
              required
            />
          </Field>
          <Field label="Waitlist cap" hint="Blank means unlimited.">
            <Input type="number" name="waitlistCap" min="1" step="1" defaultValue={defaults.waitlistCap} />
          </Field>
        </div>

        <Field
          label="Payment link"
          hint="Where members are sent to pay - the club portal link for this trip. Blank uses the club-wide link."
        >
          <Input
            type="url"
            name="paymentUrl"
            defaultValue={defaults.paymentUrl ?? ""}
            placeholder="https://club.fusionfamily.com/..."
          />
        </Field>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="requiresDues"
            defaultChecked={defaults.requiresDues}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span className="text-sm">
            <span className="font-medium text-ink">Dues required</span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              Members without dues recorded cannot claim a spot on this trip.
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-5 rounded-lg border border-border bg-paper p-6">
        <h2 className="text-sm font-semibold">The drop</h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Signups open" hint="Mountain Time. The moment the race starts.">
            <Input
              type="datetime-local"
              name="signupOpensAt"
              defaultValue={defaults.signupOpensAt}
              required
            />
          </Field>
          <Field label="Signups close" hint="Optional. Blank means they stay open.">
            <Input
              type="datetime-local"
              name="signupClosesAt"
              defaultValue={defaults.signupClosesAt}
            />
          </Field>
        </div>

        <Field
          label="Payment window (hours)"
          hint="How long a won spot is held before the hold lapses. 1 to 336."
        >
          <Input
            type="number"
            name="paymentWindowHours"
            min="1"
            max="336"
            step="1"
            defaultValue={defaults.paymentWindowHours}
            required
          />
        </Field>
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : submitLabel}
        </Button>
        <Link href={cancelHref} className="text-sm text-ink-muted underline underline-offset-4">
          Cancel
        </Link>
      </div>

      <p className="text-xs text-ink-faint">
        A new trip starts as a draft. Publish it to make it visible, then open signups
        when you are ready.
      </p>
    </form>
  );
}
