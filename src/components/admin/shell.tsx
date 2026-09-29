import { Children, type ReactNode } from "react";
import { BackLink, cn } from "@/components/ui";

/**
 * Every button on a roster card shares this size: a real tap target on a phone,
 * compact on a desktop where thirty cards are on screen at once. Lives here, not
 * in the client board, so the server page can use the same string.
 */
export const CARD_BUTTON = "h-9 px-3 text-xs sm:h-7 sm:px-2";

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        {back ? <BackLink href={back.href}>{back.label}</BackLink> : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <div className="mt-1.5 text-sm text-ink-muted">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description ? (
            <div className="mt-0.5 text-xs text-ink-muted">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-paper px-4 py-3.5">
      <p className="text-xs uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="tnum mt-1 text-xl font-semibold text-ink">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-ink-muted">{detail}</p> : null}
    </div>
  );
}

/** Wide tables scroll rather than forcing the page to. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

/**
 * The standard board table. A column is a label, or `[label, className]` when
 * it needs aligning; `empty` stands in for the rows when there are none.
 */
export function DataTable({
  columns,
  empty,
  children,
}: {
  columns?: Array<string | [label: string, className: string]>;
  empty?: ReactNode;
  children: ReactNode;
}) {
  return (
    <TableWrap>
      <table className="w-full text-sm">
        {columns ? (
          <thead className="border-b border-border">
            <tr>
              {columns.map((column, index) => (
                <Th key={index} className={typeof column === "string" ? undefined : column[1]}>
                  {typeof column === "string" ? column : column[0]}
                </Th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody className="divide-y divide-border">
          {empty && Children.count(children) === 0 ? (
            <EmptyRow colSpan={columns?.length ?? 1}>{empty}</EmptyRow>
          ) : (
            children
          )}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function Th({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <th
      className={cn(
        "whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-ink-faint",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ className, children }: { className?: string; children?: ReactNode }) {
  return <td className={cn("px-4 py-2.5 align-middle text-ink", className)}>{children}</td>;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-ink-muted">
        {children}
      </td>
    </tr>
  );
}
