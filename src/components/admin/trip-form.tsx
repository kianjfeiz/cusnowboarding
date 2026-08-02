"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { TripFormState } from "@/app/admin/trips/actions";
import { Button, Field, Input, Notice } from "@/components/ui";
import { DateTimePicker } from "@/components/admin/date-time-picker";
import { SIGNUP_WINDOW_HOURS } from "@/lib/signup-window";

export interface TripFormDefaults {
  id?: string;
  title: string;
  slug: string;
  resort: string;
  description: string;
  departAt: string;
  returnAt: string;
  signupOpensAt: string;
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

  // Five fields make a trip; the rest have defaults that have been right every
  // time. They stay one click away rather than in the way - but a trip that
  // already departs from them is opened, so nobody edits a field they cannot
  // see.
  const extrasSet =
    Boolean(defaults.resort || defaults.description || defaults.returnAt || defaults.paymentUrl) ||
    !defaults.requiresDues;

  return (
    <form action={formAction} className="space-y-6">
      {defaults.id ? <input type="hidden" name="tripId" value={defaults.id} /> : null}

      {state.error ? (
        <Notice tone="alert" title="Not saved">
          {state.error}
        </Notice>
      ) : null}

      <section className="space-y-5 rounded-lg border border-border bg-paper p-6">
        <Field label="Title">
          <Input
            name="title"
            defaultValue={defaults.title}
            required
            maxLength={120}
            placeholder="Breckenridge day trip"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Departs" hint="Mountain Time.">
            <DateTimePicker name="departAt" defaultValue={defaults.departAt} required />
          </Field>
          <Field
            label="Signups open"
            hint={`Mountain Time. The trip opens itself at this moment and closes ${SIGNUP_WINDOW_HOURS} hours later.`}
          >
            <DateTimePicker
              name="signupOpensAt"
              defaultValue={defaults.signupOpensAt}
              required
            />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Price" hint="Dollars per rider.">
            <Input
              type="number"
              name="priceDollars"
              step="0.01"
              min="0"
              defaultValue={defaults.priceDollars}
              required
            />
          </Field>
          <Field
            label="Capacity"
            hint={
              defaults.id
                ? "Spots on the bus. Raising this after a drop does not let anyone new claim - a spot only goes to an entry numbered at or below capacity, so fill it from the waitlist."
                : "Spots on the bus."
            }
          >
            <Input
              type="number"
              name="capacity"
              min="1"
              step="1"
              defaultValue={defaults.capacity}
              required
            />
          </Field>
        </div>
      </section>

      <details className="rounded-lg border border-border bg-paper" open={extrasSet}>
        <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-ink">
          Everything else
          <span className="ml-2 font-normal text-ink-muted">
            already set, change it if you need to
          </span>
        </summary>

        <div className="space-y-5 border-t border-border px-6 py-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Resort">
              <Input name="resort" defaultValue={defaults.resort} maxLength={80} />
            </Field>
            <Field label="Returns" hint="Leave blank for a day trip.">
              <DateTimePicker name="returnAt" defaultValue={defaults.returnAt} />
            </Field>
          </div>

          <Field label="Description" hint="Shown on the public trip page.">
            <textarea
              name="description"
              rows={3}
              defaultValue={defaults.description}
              className={inputClass}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Waitlist cap" hint="Blank means unlimited.">
              <Input
                type="number"
                name="waitlistCap"
                min="1"
                step="1"
                defaultValue={defaults.waitlistCap}
              />
            </Field>
            <Field
              label="Payment window (hours)"
              hint="How long a won spot is held once results go out."
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
          </div>

          <Field label="URL slug" hint="Made from the title if you leave this blank.">
            <Input name="slug" defaultValue={defaults.slug} maxLength={80} />
          </Field>

          <Field
            label="Payment link"
            hint="Where members are sent to pay. Blank uses the club-wide link."
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
        </div>
      </details>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : submitLabel}
        </Button>
        <Link
          href={cancelHref}
          className="inline-flex h-10 items-center text-sm text-ink-muted underline underline-offset-4"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
