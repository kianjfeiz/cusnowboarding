"use client";

import { useActionState } from "react";
import { Button, Notice } from "@/components/ui";
import { importDues, type DuesImportState } from "./actions";

export function DuesImport() {
  const [state, formAction, pending] = useActionState<DuesImportState, FormData>(
    importDues,
    {},
  );

  return (
    <form action={formAction} className="space-y-4 px-5 py-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">
          Paid addresses
        </span>
        <textarea
          name="emails"
          rows={6}
          required
          placeholder={"one@colorado.edu\ntwo@colorado.edu"}
          className="w-full rounded-md border border-border bg-paper px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <span className="mt-1 block text-xs text-ink-muted">
          Paste a column from the dues spreadsheet. Commas, semicolons, line breaks, and
          extra columns are all fine - anything that looks like an address is read, the
          rest is ignored.
        </span>
      </label>

      {state.error ? (
        <Notice tone="alert" title="Nothing imported">
          {state.error}
        </Notice>
      ) : null}

      {state.result ? (
        <Notice
          tone={state.result.unmatched.length > 0 ? "alert" : "accent"}
          title={`${state.result.matched} of ${state.result.submitted} addresses matched a member`}
        >
          <p>
            {state.result.newlyMarked} newly marked as paid;{" "}
            {state.result.matched - state.result.newlyMarked} already were.
          </p>
          {state.result.unmatched.length > 0 ? (
            <div className="mt-2">
              <p className="font-medium text-ink">
                {state.result.unmatched.length} not found. No member was created for
                these - they have not signed up on the site yet, or the address differs
                from the one they used.
              </p>
              <ul className="mt-1.5 max-h-40 overflow-y-auto font-mono text-xs">
                {state.result.unmatched.map((email) => (
                  <li key={email}>{email}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Notice>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Importing" : "Import dues"}
      </Button>
    </form>
  );
}
