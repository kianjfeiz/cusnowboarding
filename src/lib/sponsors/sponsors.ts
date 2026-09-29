import { asc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { sponsorCodes, sponsors } from "@/lib/db/schema";

export interface SponsorCode {
  id: string;
  code: string;
  details: string | null;
}

export interface Sponsor {
  id: string;
  name: string;
  websiteUrl: string | null;
  description: string | null;
  codes: SponsorCode[];
}

export async function listSponsors(): Promise<Sponsor[]> {
  const [rows, codes] = await Promise.all([
    db
      .select({
        id: sponsors.id,
        name: sponsors.name,
        websiteUrl: sponsors.websiteUrl,
        description: sponsors.description,
      })
      .from(sponsors)
      .orderBy(sql`lower(${sponsors.name})`),
    db
      .select({
        id: sponsorCodes.id,
        sponsorId: sponsorCodes.sponsorId,
        code: sponsorCodes.code,
        details: sponsorCodes.details,
      })
      .from(sponsorCodes)
      .orderBy(asc(sponsorCodes.createdAt)),
  ]);

  return rows.map((sponsor) => ({
    ...sponsor,
    codes: codes
      .filter((code) => code.sponsorId === sponsor.id)
      .map(({ id, code, details }) => ({ id, code, details })),
  }));
}

/**
 * Accepts "burton.com" as well as a full URL, and only ever returns http(s):
 * the value becomes a link on the member page, so a javascript: URL must not
 * survive. Null means blank; undefined means unusable.
 */
export function normalizeWebsite(raw: string): string | null | undefined {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
