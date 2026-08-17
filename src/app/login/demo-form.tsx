"use client";

import { useActionState } from "react";
import { signInWithDemo, type DemoFormState } from "./actions";
import { Notice } from "@/components/ui";

/**
 * The recruiter's way in, below the real one and quieter than it.
 *
 * Kept visually secondary on purpose: this is the door for someone who has no
 * CU account, not an alternative for members, and nothing about it should
 * suggest the board signs in this way.
 */
export function DemoForm() {
  const [state, formAction, pending] = useActionState<DemoFormState, FormData>(
    signInWithDemo,
    {},
  );

  return (
    <div className="mt-6">
      {/* A ruled label rather than a plain heading: it separates two ways in
          without implying the one below is equal to the one above. */}
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wide text-ink-faint">
          or just look around
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={formAction} className="mt-4">
        <label htmlFor="demo-password" className="sr-only">
          Demo password
        </label>

        {state.error ? (
          <div className="mb-3">
            <Notice tone="alert">{state.error}</Notice>
          </div>
        ) : null}

        <div className="flex gap-2">
          <input
            id="demo-password"
            name="password"
            type="password"
            autoComplete="off"
            placeholder="Demo password"
            required
            className="h-11 w-full rounded-xl border border-border bg-paper/70 px-3.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-xl border border-border-strong px-4 text-sm font-medium text-ink transition-[background-color,transform] duration-150 hover:bg-surface active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            {pending ? "Checking" : "View demo"}
          </button>
        </div>

        <p className="mt-2.5 text-xs text-ink-muted">
          Browse the site as a visitor. Read only - you cannot enter a drop, and
          the member directory stays closed.
        </p>
      </form>
    </div>
  );
}
