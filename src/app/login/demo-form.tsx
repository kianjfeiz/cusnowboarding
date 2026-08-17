"use client";

import { useActionState } from "react";
import { signInWithDemo, type DemoFormState } from "./actions";
import { Button, Input, Notice } from "@/components/ui";

/**
 * The recruiter's way in. Kept visually secondary to the Google button: this is
 * the door for someone who cannot use the real one, not an alternative for
 * members, and nothing about it should suggest the board signs in this way.
 */
export function DemoForm() {
  const [state, formAction, pending] = useActionState<DemoFormState, FormData>(
    signInWithDemo,
    {},
  );

  return (
    <form action={formAction} className="mt-8 border-t border-border pt-6">
      <label htmlFor="demo-password" className="block text-sm font-medium text-ink">
        Just looking around?
      </label>
      <p className="mt-1 text-xs text-ink-muted">
        Enter the demo password to browse the member site. Read only - you
        cannot enter a drop or reach the board portal.
      </p>

      {state.error ? (
        <div className="mt-3">
          <Notice tone="alert">{state.error}</Notice>
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        <Input
          id="demo-password"
          name="password"
          type="password"
          autoComplete="off"
          placeholder="Demo password"
          required
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={pending}
          className="shrink-0 whitespace-nowrap"
        >
          {pending ? "Checking" : "View demo"}
        </Button>
      </div>
    </form>
  );
}
