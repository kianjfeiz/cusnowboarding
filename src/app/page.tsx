import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { trips } from "@/lib/db/schema";
import { Badge, Card, formatDenver, formatMoney } from "@/components/ui";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

/**
 * A scheduled trip opens itself the moment its clock arrives, so "scheduled"
 * no longer means "not yet claimable" - the time does. Reading the status alone
 * would tell a member signups open at 8pm while the button beside it is already
 * live.
 */
function signupLabel(trip: {
  status: string;
  signupOpensAt: Date;
  signupClosesAt: Date | null;
}): string {
  if (trip.status === "closed") return "Signups closed";

  const now = Date.now();
  if (trip.signupOpensAt.getTime() > now) {
    return `Signups open ${formatDenver(trip.signupOpensAt)}`;
  }
  if (trip.signupClosesAt && trip.signupClosesAt.getTime() <= now) {
    return "Signups closed";
  }
  return "Signups open now";
}

export default async function Home() {
  const upcoming = await db
    .select()
    .from(trips)
    .where(inArray(trips.status, ["scheduled", "open", "closed"]))
    .orderBy(desc(trips.signupOpensAt))
    .limit(20);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-5 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Trips</h1>
        <p className="mt-2 text-sm text-ink-muted">This season.</p>
      </header>

      {upcoming.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">No trips posted yet.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {upcoming.map((trip) => (
            <li key={trip.id}>
              <Link
                href={`/trips/${trip.slug}`}
                className="block rounded-lg border border-border bg-paper p-5 transition-colors hover:border-border-strong"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-ink">{trip.title}</p>
                    <p className="mt-1 text-sm text-ink-muted">{signupLabel(trip)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Badge emphasis="strong">{formatMoney(trip.priceCents)}</Badge>
                    <span className="text-xs text-ink-faint">{trip.capacity} spots</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      </main>
    </>
  );
}
