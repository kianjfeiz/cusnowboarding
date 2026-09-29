import Link from "next/link";
import type { CSSProperties, ComponentProps, ReactNode } from "react";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Paints a PNG's alpha channel with `currentColor` on a `bg-current` element,
 * so one hand-drawn asset serves light and dark and always matches the text
 * beside it. An <img> would need a copy per theme.
 */
export function inkMask(url: string, position = "left center"): CSSProperties {
  const image = `url(${url})`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: position,
    WebkitMaskPosition: position,
  };
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
  children?: ReactNode;
}) {
  const tones = {
    neutral: "border-border bg-surface text-ink",
    accent: "border-accent/30 bg-accent-soft text-ink",
    alert: "border-alert/30 bg-alert-soft text-ink",
  } as const;

  return (
    <div className={cn("rounded-md border p-4 text-sm", tones[tone])}>
      {title ? <p className={cn("font-semibold", children ? "mb-1" : null)}>{title}</p> : null}
      {children ? <div className="text-ink-muted">{children}</div> : null}
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

/** A curved back arrow, for every link that returns to where the page came from. */
export function BackArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

/** The way back from a page, shared by the member and board page headers. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      // Vertical padding grows the tap target without adding height to the header.
      className="-my-2 inline-flex items-center gap-1.5 py-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
    >
      <BackArrow />
      {children}
    </Link>
  );
}

/**
 * The header of a page reached from somewhere else: an explicit way back, the
 * title, and optional lines under it. Pages arrived at from an email link need
 * the way out or the member is stuck on them.
 */
export function PageHeader({
  back,
  backLabel,
  title,
  children,
}: {
  back: string;
  backLabel: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8">
      <BackLink href={back}>{backLabel}</BackLink>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
      {children}
    </header>
  );
}

export function SectionHeading({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn("text-sm font-semibold uppercase tracking-wide text-ink-faint", className)}
      {...props}
    />
  );
}

/** One label-over-value pair inside a `<dl>`. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
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

/** `formatDenver` options for a date without its time of day. */
export const DAY_ONLY = { hour: undefined, minute: undefined, timeZoneName: undefined } as const;

/** "2d 03:04:05" or "03:04:05". Pair with `tnum` so the digits do not jitter. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}
