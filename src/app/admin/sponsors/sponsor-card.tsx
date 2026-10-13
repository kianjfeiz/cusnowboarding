"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button, Input } from "@/components/ui";
import type { Sponsor } from "@/lib/sponsors/sponsors";
import { addSponsorCode, deleteSponsor, removeSponsorCode } from "./actions";
import { SponsorForm } from "./sponsor-form";

const LINK_BUTTON =
  "text-sm text-accent underline underline-offset-4 transition-colors hover:text-accent-hover";

export function NewSponsor({ startOpen }: { startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);

  if (!open) {
    return (
      <Button type="button" className="h-9 px-4" onClick={() => setOpen(true)}>
        Add sponsor
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-paper p-5">
      <h2 className="mb-4 text-sm font-semibold text-ink">New sponsor</h2>
      <SponsorForm
        submitLabel="Add sponsor"
        onDone={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

/**
 * One sponsor as members will read it, edited in place. Details save as a
 * form; codes are added and removed one at a time and take effect at once, so
 * they stay outside the edit form where Cancel cannot seem to undo them.
 */
export function SponsorCard({ sponsor, mayManage }: { sponsor: Sponsor; mayManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const [addingCode, setAddingCode] = useState(false);

  const codeCount = sponsor.codes.length;
  const removeConfirm = `Remove ${sponsor.name}${
    codeCount > 0 ? ` and its ${codeCount} code${codeCount === 1 ? "" : "s"}` : ""
  }? Members stop seeing it right away.`;

  return (
    <li className="rounded-lg border border-border bg-paper p-5">
      {editing ? (
        // Remove is its own form - a second submit inside the edit form would
        // share its pending state - laid over the end of Save's row where
        // there is room, and stacked below it on a narrow phone.
        <div className="relative">
          <SponsorForm
            sponsor={sponsor}
            submitLabel="Save"
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
          <form
            action={deleteSponsor}
            className="mt-3 sm:absolute sm:bottom-0 sm:right-0 sm:mt-0"
          >
            <input type="hidden" name="sponsorId" value={sponsor.id} />
            <SubmitButton
              variant="danger"
              pendingLabel="Removing"
              confirm={removeConfirm}
              className="h-9 px-3 text-sm"
            >
              Remove sponsor
            </SubmitButton>
          </form>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-ink">{sponsor.name}</h2>
            {sponsor.websiteUrl ? (
              <a
                href={sponsor.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
              >
                {new URL(sponsor.websiteUrl).host}
              </a>
            ) : null}
            {sponsor.description ? (
              <p className="mt-2 text-sm text-ink-muted">{sponsor.description}</p>
            ) : null}
          </div>
          {mayManage ? (
            <Button
              type="button"
              variant="secondary"
              className="h-8 shrink-0 px-3 text-xs"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          ) : null}
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-xs uppercase tracking-wide text-ink-faint">Codes</h3>

        {codeCount === 0 && !addingCode ? (
          <p className="mt-1.5 text-sm text-ink-faint">None yet.</p>
        ) : null}

        {codeCount > 0 ? (
          <ul className="mt-1.5 space-y-1.5">
            {sponsor.codes.map((code) => (
              <li key={code.id} className="flex items-baseline justify-between gap-4">
                <p className="min-w-0 text-sm">
                  <span className="break-all font-mono font-semibold text-ink">{code.code}</span>
                  {code.details ? <span className="text-ink-muted"> - {code.details}</span> : null}
                </p>
                {mayManage ? (
                  <form action={removeSponsorCode} className="shrink-0">
                    <input type="hidden" name="codeId" value={code.id} />
                    <SubmitButton
                      variant="quiet"
                      pendingLabel="Removing"
                      confirm={`Remove the code ${code.code}?`}
                    >
                      Remove
                    </SubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {mayManage && addingCode ? (
          <form
            action={async (formData) => {
              await addSponsorCode(formData);
              setAddingCode(false);
            }}
            className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            <input type="hidden" name="sponsorId" value={sponsor.id} />
            <Input
              name="code"
              required
              maxLength={80}
              autoComplete="off"
              autoFocus
              placeholder="Code"
              aria-label="Code"
              className="font-mono sm:w-48"
            />
            <Input
              name="details"
              maxLength={200}
              autoComplete="off"
              placeholder="What it gets you, e.g. 10% off"
              aria-label="What it gets you"
              className="sm:flex-1"
            />
            <div className="flex gap-2">
              <SubmitButton pendingLabel="Adding" variant="primary" className="h-10 px-4 text-sm">
                Add
              </SubmitButton>
              <Button
                type="button"
                variant="quiet"
                className="h-10 px-3"
                onClick={() => setAddingCode(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {mayManage && !addingCode ? (
          <button type="button" className={`mt-2 ${LINK_BUTTON}`} onClick={() => setAddingCode(true)}>
            Add code
          </button>
        ) : null}
      </div>
    </li>
  );
}
