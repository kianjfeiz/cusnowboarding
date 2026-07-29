"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { EVENT_KINDS, EVENT_KIND_LABELS, type ClubEventKind } from "@/lib/event-kinds";
import type { EventFormState } from "./actions";

export interface EventFormDefaults {
  id?: string;
  title: string;
  slug: string;
  kind: ClubEventKind;
  description: string;
  locationName: string;
  address: string;
  mapUrl: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  isTwentyOnePlus: boolean;
}

const inputClass =
  "w-full rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";

export function EventForm({
  action,
  defaults,
  submitLabel,
  cancelHref,
}: {
  action: (state: EventFormState, formData: FormData) => Promise<EventFormState>;
  defaults: EventFormDefaults;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<EventFormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-8">
      {defaults.id ? <input type="hidden" name="eventId" value={defaults.id} /> : null}

      {state.error ? (
        <Notice tone="alert" title="Not saved">
          {state.error}
        </Notice>
      ) : null}

      <section className="space-y-5 rounded-lg border border-border bg-paper p-6">
        <h2 className="text-sm font-semibold">The event</h2>

        <Field label="Title">
          <Input name="title" defaultValue={defaults.title} required maxLength={120} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Kind">
            <select name="kind" defaultValue={defaults.kind} className={inputClass}>
              {EVENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {EVENT_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="URL slug" hint="Leave blank to derive it from the title.">
            <Input name="slug" defaultValue={defaults.slug} maxLength={80} />
          </Field>
        </div>

        <Field label="Description" hint="Shown when a member opens the event on the calendar.">
          <textarea
            name="description"
            rows={4}
            defaultValue={defaults.description}
            className={inputClass}
          />
        </Field>
      </section>

      <section className="space-y-5 rounded-lg border border-border bg-paper p-6">
        <h2 className="text-sm font-semibold">When</h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Starts" hint="Mountain Time.">
            <Input
              type="datetime-local"
              name="startsAt"
              defaultValue={defaults.startsAt}
              required
            />
          </Field>
          <Field label="Ends" hint="Mountain Time. Optional.">
            <Input type="datetime-local" name="endsAt" defaultValue={defaults.endsAt} />
          </Field>
        </div>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="allDay"
            defaultChecked={defaults.allDay}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span className="text-sm">
            <span className="font-medium text-ink">All day</span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              The calendar shows the date only. Still pick a start date above; its clock
              time is ignored.
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-5 rounded-lg border border-border bg-paper p-6">
        <h2 className="text-sm font-semibold">Where</h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Location name" hint="For example, the UMC or a house.">
            <Input name="locationName" defaultValue={defaults.locationName} maxLength={120} />
          </Field>
          <Field label="Address">
            <Input name="address" defaultValue={defaults.address} maxLength={200} />
          </Field>
        </div>

        <Field label="Map link" hint="Optional. Paste a Google or Apple Maps URL.">
          <Input
            type="url"
            name="mapUrl"
            defaultValue={defaults.mapUrl}
            maxLength={500}
            placeholder="https://"
          />
        </Field>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="isTwentyOnePlus"
            defaultChecked={defaults.isTwentyOnePlus}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span className="text-sm">
            <span className="font-medium text-ink">21 and over</span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              Flagged on the member calendar so nobody turns up and cannot get in.
            </span>
          </span>
        </label>
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : submitLabel}
        </Button>
        <Link href={cancelHref} className="text-sm text-ink-muted underline underline-offset-4">
          Cancel
        </Link>
      </div>
    </form>
  );
}
