import type { ComponentProps, ReactNode } from "react";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "quiet" | "danger" }) {
  const base =
    "inline-flex items-center justify-center rounded-md px-4 h-10 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";
  const variants = {
    primary: "bg-accent text-white hover:bg-accent-hover",
    secondary: "border border-border-strong bg-paper text-ink hover:bg-surface",
    quiet: "text-ink-muted hover:text-ink hover:bg-surface",
    danger: "border border-border-strong text-alert hover:bg-alert-soft",
  } as const;

  return <button className={cn(base, variants[variant], className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border border-border bg-paper px-3 text-sm text-ink",
        "placeholder:text-ink-faint focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-muted">{hint}</span> : null}
    </label>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-paper p-6", className)}
      {...props}
    />
  );
}

export function Notice({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "accent" | "alert";
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    neutral: "border-border bg-surface text-ink",
    accent: "border-accent/30 bg-accent-soft text-ink",
    alert: "border-alert/30 bg-alert-soft text-ink",
  } as const;

  return (
    <div className={cn("rounded-md border p-4 text-sm", tones[tone])}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="text-ink-muted">{children}</div>
    </div>
  );
}

/**
 * Status is conveyed by the word first; the border weight is a secondary cue.
 * Deliberately not colour-coded per status - a roster reads better in one hue.
 */
export function Badge({
  emphasis = "normal",
  children,
}: {
  emphasis?: "normal" | "strong" | "muted";
  children: ReactNode;
}) {
  const styles = {
    strong: "border-ink/25 bg-surface-strong text-ink font-semibold",
    normal: "border-border bg-surface text-ink",
    muted: "border-border bg-transparent text-ink-faint",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 text-xs whitespace-nowrap",
        styles[emphasis],
      )}
    >
      {children}
    </span>
  );
}

export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const DENVER = "America/Denver";

/** All club-facing times are Mountain, because the trips are. */
export function formatDenver(date: Date | string, opts: Intl.DateTimeFormatOptions = {}) {
  return new Date(date).toLocaleString("en-US", {
    timeZone: DENVER,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...opts,
  });
}
