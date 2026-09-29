import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sponsorCodes, sponsors } from "@/lib/db/schema";
import { listSponsors, normalizeWebsite } from "@/lib/sponsors/sponsors";

describe("normalizeWebsite", () => {
  it("adds https to a bare domain and keeps http(s) URLs", () => {
    expect(normalizeWebsite("burton.com")).toBe("https://burton.com/");
    expect(normalizeWebsite("http://example.com/deals")).toBe("http://example.com/deals");
  });

  it("treats blank as no website", () => {
    expect(normalizeWebsite("   ")).toBeNull();
  });

  it("refuses anything that is not a web link, since it becomes an href", () => {
    expect(normalizeWebsite("javascript:alert(1)")).toBeUndefined();
    expect(normalizeWebsite("data:text/html,hi")).toBeUndefined();
    expect(normalizeWebsite("not a url")).toBeUndefined();
  });
});

describe("listSponsors", () => {
  const name = `test-sponsor-${Date.now()}`;

  afterAll(async () => {
    await db.delete(sponsors).where(eq(sponsors.name, name));
  });

  it("returns each sponsor with its codes in the order they were added", async () => {
    const [sponsor] = await db
      .insert(sponsors)
      .values({ name, websiteUrl: "https://example.com/" })
      .returning({ id: sponsors.id });
    await db.insert(sponsorCodes).values({ sponsorId: sponsor.id, code: "FIRST", details: "10% off" });
    await db.insert(sponsorCodes).values({ sponsorId: sponsor.id, code: "SECOND", details: null });

    const listed = (await listSponsors()).find((s) => s.id === sponsor.id);
    expect(listed).toMatchObject({ name, websiteUrl: "https://example.com/", description: null });
    expect(listed?.codes.map((c) => [c.code, c.details])).toEqual([
      ["FIRST", "10% off"],
      ["SECOND", null],
    ]);
  });

  it("drops a sponsor's codes with the sponsor", async () => {
    const [sponsor] = await db.insert(sponsors).values({ name }).returning({ id: sponsors.id });
    await db.insert(sponsorCodes).values({ sponsorId: sponsor.id, code: "GONE" });
    await db.delete(sponsors).where(eq(sponsors.id, sponsor.id));

    const left = await db.select().from(sponsorCodes).where(eq(sponsorCodes.sponsorId, sponsor.id));
    expect(left).toEqual([]);
  });
});
