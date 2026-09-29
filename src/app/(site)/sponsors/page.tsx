import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { listSponsors } from "@/lib/sponsors/sponsors";
import { CopyCode } from "./copy-code";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sponsors - CU Snowboarding",
  robots: { index: false, follow: false },
};

export default async function SponsorsPage() {
  const sponsors = await listSponsors();

  return (
    <main className="mx-auto max-w-7xl px-5 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Sponsors</h1>
      </header>

      {sponsors.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">No sponsors yet.</p>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sponsors.map((sponsor) => (
            <li key={sponsor.id} className="rounded-lg border border-border bg-paper p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="min-w-0 font-semibold text-ink">{sponsor.name}</h2>
                {sponsor.websiteUrl ? (
                  <a
                    href={sponsor.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
                  >
                    Website
                  </a>
                ) : null}
              </div>
              {sponsor.description ? (
                <p className="mt-1.5 text-sm text-ink-muted">{sponsor.description}</p>
              ) : null}

              {sponsor.codes.length > 0 ? (
                <ul className="mt-4 space-y-3">
                  {sponsor.codes.map((code) => (
                    <li key={code.id}>
                      <CopyCode code={code.code} />
                      {code.details ? (
                        <p className="mt-1 text-xs text-ink-muted">{code.details}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
