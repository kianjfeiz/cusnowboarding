"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { TripFormState } from "@/app/admin/trips/actions";
import { Button, Field, Input, Notice } from "@/components/ui";
import { SIGNUP_WINDOW_HOURS } from "@/lib/claims/signup-window";

export interface TripFormDefaults {
  id?: string;
  title: string;
  resort: string;
  description: string;
  departAt: string;
  returnAt: string;
  signupOpensAt: string;
  signupPhrase: string;
  priceDollars: string;
  capacity: string;
  waitlistCap: string;
  paymentWindowHours: string;
  requiresDues: boolean;
  paymentUrl: string | null;
}

const inputClass =
  "w-full rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";

/*
  The date fields are the browser's own `datetime-local`. It submits
  `YYYY-MM-DDTHH:mm` with no zone, which is exactly what parseDenverInput reads
  as Mountain Time and what toDenverInput writes for the defaults - so the
  board's own laptop clock never enters into it.

  `scheme-light-dark` is for the parts of the control this palette cannot
  reach: without it the calendar glyph and the popup stay light-themed and
  disappear into dark paper.
*/
const dateTimeClass = "tnum scheme-light-dark";

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

  // In state only so the return can take its `min` from the departure, and the
  // browser refuses a backwards trip before the server has to. The return is
  // held too because React resets uncontrolled fields after a rejected save,
  // which would put it back to its default under a `min` that had not moved.
  const [departAt, setDepartAt] = useState(defaults.departAt);
  const [returnAt, setReturnAt] = useState(defaults.returnAt);

  // A handful of fields make a trip; the rest have defaults that have been right
  // every time. They stay one click away rather than in the way - but a trip that
  // already departs from them is opened, so nobody edits a field they cannot
  // see.
  const extrasSet = Boolean(defaults.resort || defaults.description || defaults.paymentUrl);

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
            <Input
              type="datetime-local"
              name="departAt"
              value={departAt}
              onChange={(event) => setDepartAt(event.target.value)}
              required
              className={dateTimeClass}
            />
          </Field>
          <Field label="Returns" hint="Mountain Time.">
            <Input
              type="datetime-local"
              name="returnAt"
              value={returnAt}
              min={departAt || undefined}
              onChange={(event) => setReturnAt(event.target.value)}
              required
              className={dateTimeClass}
            />
          </Field>
        </div>

        <Field
          label="Signups open"
          hint={`Mountain Time. Opens by itself, and closes ${SIGNUP_WINDOW_HOURS} hours later.`}
        >
          <Input
            type="datetime-local"
            name="signupOpensAt"
            defaultValue={defaults.signupOpensAt}
            required
            className={dateTimeClass}
          />
        </Field>

        <Field
          label="Signup phrase"
          hint="Members type this to enter. It shows on the trip page once signups open."
        >
          <Input
            name="signupPhrase"
            defaultValue={defaults.signupPhrase}
            required
            maxLength={80}
            placeholder="send it breck"
          />
        </Field>

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
            hint="Paying spots. Board seats are extra."
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

        {/*
          Radios rather than a checkbox, and in the main section rather than
          behind the disclosure. An unchecked checkbox submits nothing, so the
          absent-field case had to mean "dues not required" - the fail-open
          direction, decided by a control the board never saw. Two named options
          make the choice explicit in the form data, which lets the parser treat
          anything it does not recognise as "required".
        */}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">Club dues</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-3 rounded-md border border-border p-3 transition-colors has-[:checked]:border-border-strong has-[:checked]:bg-surface">
              <input
                type="radio"
                name="requiresDues"
                value="required"
                defaultChecked={defaults.requiresDues}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span className="text-sm">
                <span className="font-medium text-ink">Dues required</span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  Only members with dues recorded can enter the drop.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-md border border-border p-3 transition-colors has-[:checked]:border-border-strong has-[:checked]:bg-surface">
              <input
                type="radio"
                name="requiresDues"
                value="open"
                defaultChecked={!defaults.requiresDues}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span className="text-sm">
                <span className="font-medium text-ink">Open to everyone</span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  Anyone signed in can enter, dues paid or not.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
      </section>

      <details className="rounded-lg border border-border bg-paper" open={extrasSet}>
        <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-ink">
          Everything else
          <span className="ml-2 font-normal text-ink-muted">defaults are usually right</span>
        </summary>

        <div className="space-y-5 border-t border-border px-6 py-5">
          <Field label="Resort">
            <Input name="resort" defaultValue={defaults.resort} maxLength={80} />
          </Field>

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
              hint="How long a rider has to pay once the roster is released."
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
          Discard
        </Link>
      </div>
    </form>
  );
}
