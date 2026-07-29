"use client";

import { useActionState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { addBoardUser, type BoardUserFormState } from "./actions";

export function AddBoardUser() {
  const [state, formAction, pending] = useActionState<BoardUserFormState, FormData>(
    addBoardUser,
    {},
  );

  return (
    <form action={formAction} className="space-y-4 px-5 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" hint="The address they sign in with.">
          <Input name="email" type="email" required placeholder="name@colorado.edu" />
        </Field>
        <Field label="Name" hint="Optional. Shown in the header and on audit entries.">
          <Input name="name" maxLength={80} />
        </Field>
      </div>

      {state.error ? (
        <Notice tone="alert" title="Not added">
          {state.error}
        </Notice>
      ) : null}

      {state.added ? (
        <Notice tone="accent" title="Added">
          {state.added} can sign in now. Assign them a role for this term so they can do
          more than read.
        </Notice>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Adding" : "Add board user"}
      </Button>
    </form>
  );
}
