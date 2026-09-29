"use client";

import type { MouseEvent } from "react";
import { useFormStatus } from "react-dom";
import { Button, cn } from "@/components/ui";

/**
 * A form submit that disables itself while the action is in flight, and
 * optionally asks first. Releases and cancellations are not undoable from the
 * UI, so they get a confirmation.
 */
export function SubmitButton({
  children,
  pendingLabel,
  confirm,
  disabled,
  variant = "secondary",
  className,
  title,
  form,
  name,
  value,
}: {
  children: string;
  pendingLabel?: string;
  confirm?: string;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  className?: string;
  title?: string;
  /** Posts a form elsewhere on the page, e.g. a row button inside a table. */
  form?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();

  function onClick(event: MouseEvent<HTMLButtonElement>) {
    if (confirm && !window.confirm(confirm)) event.preventDefault();
  }

  return (
    <Button
      type="submit"
      variant={variant}
      title={title}
      form={form}
      name={name}
      value={value}
      onClick={onClick}
      disabled={disabled || pending}
      className={cn("h-8 px-3 text-xs", className)}
    >
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
