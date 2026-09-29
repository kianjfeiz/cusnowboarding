import { NextResponse } from "next/server";

/** Shared by the roster and reconciliation exports so they quote and date alike. */

type Cell = string | number | null | undefined;

function csvCell(value: Cell): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Excel and Sheets both treat a leading =, +, - or @ as a formula.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

const DENVER: Intl.DateTimeFormatOptions = {
  timeZone: "America/Denver",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

export const csvTime = (value: Date | null) =>
  value ? new Date(value).toLocaleString("en-US", DENVER) : "";

/** Cents to dollars happens once, on the way out. */
export const csvDollars = (cents: number) => (cents / 100).toFixed(2);

export function csvResponse(filename: string, header: string[], rows: Cell[][]): NextResponse {
  const body = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
