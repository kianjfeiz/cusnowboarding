import { notFound } from "next/navigation";
import { EmptyRow, PageHeader, Section, Stat, TableWrap, Td, Th } from "@/components/admin/shell";
import { Badge } from "@/components/ui";
import { requireCapability } from "../../../_lib/actor";
import { getTripSummary, listClaimAttempts } from "../../../_lib/queries";

export const dynamic = "force-dynamic";

const LIMIT = 500;

/** The outcomes `claimSpot` can return. Anything unrecognised falls back to the raw value. */
const RESULT_LABELS: Record<string, string> = {
  held: "Got a spot",
  waitlisted: "Waitlisted",
  duplicate: "Already signed up",
  not_open: "Signups not open",
  unverified: "Email not verified",
  not_member: "Dues not paid",
  full: "Waitlist full",
  error: "Server error",
};

function resultLabel(result: string): string {
  return RESULT_LABELS[result] ?? result;
}

export default async function DropLogPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCapability("viewRosters");

  const { id } = await params;
  const trip = await getTripSummary(id);
  if (!trip) notFound();

  const attempts = await listClaimAttempts(id, LIMIT);

  const counts = new Map<string, number>();
  for (const attempt of attempts) {
    counts.set(attempt.result, (counts.get(attempt.result) ?? 0) + 1);
  }
  const summary = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader
        title={`Drop log: ${trip.title}`}
        back={{ href: `/admin/trips/${trip.id}`, label: "Back to roster" }}
        subtitle={
          <>
            <p>
              This is the server&apos;s own record of when each claim request arrived, to
              the millisecond, and it is what settles an argument about who clicked first.
            </p>
            <p className="mt-1">
              The claim sequence is the authoritative order: it is issued one at a time
              under the trip row lock, so no two riders can share a number no matter how
              close their clocks or their screens looked.
            </p>
          </>
        }
      />

      {summary.length > 0 ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Attempts" value={attempts.length} detail="Every request, not just the winners" />
          {summary.map(([result, count]) => (
            <Stat key={result} label={resultLabel(result)} value={count} />
          ))}
        </div>
      ) : null}

      <Section
        title="Every attempt, in arrival order"
        description={
          attempts.length === LIMIT
            ? `Showing the first ${LIMIT} attempts recorded for this trip.`
            : "Read-only. Nothing on this page can be edited."
        }
      >
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <Th className="text-right">#</Th>
                <Th>Server time</Th>
                <Th>Result</Th>
                <Th className="text-right">Seq</Th>
                <Th>Rider</Th>
                <Th className="text-right">Latency</Th>
                <Th>IP</Th>
                <Th>User agent</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {attempts.length === 0 ? (
                <EmptyRow colSpan={8}>
                  No claim attempts recorded for this trip yet.
                </EmptyRow>
              ) : (
                attempts.map((attempt, index) => (
                  <tr key={attempt.id} className="hover:bg-surface">
                    <Td className="tnum text-right text-ink-faint">{index + 1}</Td>
                    <Td className="tnum whitespace-nowrap">
                      {attempt.at_denver}
                      <span className="mt-0.5 block text-xs text-ink-faint">
                        {attempt.at_utc} UTC
                      </span>
                    </Td>
                    <Td>
                      <Badge
                        emphasis={
                          attempt.result === "held"
                            ? "strong"
                            : attempt.result === "waitlisted"
                              ? "normal"
                              : "muted"
                        }
                      >
                        {resultLabel(attempt.result)}
                      </Badge>
                    </Td>
                    <Td className="tnum text-right">{attempt.claim_seq ?? "-"}</Td>
                    <Td className="text-ink-muted">
                      {attempt.email ?? (
                        <span
                          className="font-mono text-xs"
                          title={attempt.member_id ?? undefined}
                        >
                          {attempt.member_id ? `${attempt.member_id.slice(0, 8)}...` : "-"}
                        </span>
                      )}
                    </Td>
                    <Td className="tnum whitespace-nowrap text-right text-ink-muted">
                      {attempt.latency_ms === null ? "-" : `${attempt.latency_ms} ms`}
                    </Td>
                    <Td className="tnum whitespace-nowrap text-xs text-ink-muted">
                      {attempt.ip ?? "-"}
                    </Td>
                    <Td>
                      <span
                        className="block max-w-72 truncate text-xs text-ink-faint"
                        title={attempt.user_agent ?? undefined}
                      >
                        {attempt.user_agent ?? "-"}
                      </span>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableWrap>
      </Section>
    </>
  );
}
