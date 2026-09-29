import Link from "next/link";
import { EmptyRow, PageHeader, Section, TableWrap, Td, Th } from "@/components/admin/shell";
import { SubmitButton } from "@/components/admin/submit-button";
import { Badge, Button, formatDenver } from "@/components/ui";
import { can } from "@/lib/auth/authz";
import {
  EVENT_KIND_LABELS,
  EVENT_STATUS_LABELS,
  eventTransitionLabel,
  listEvents,
  nextEventStatuses,
} from "@/lib/events/events";
import { requireActor } from "../_lib/actor";
import { deleteEventAction, setEventStatus } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminEventsPage() {
  const actor = await requireActor();
  const events = await listEvents();
  const mayManage = can(actor, "manageEvents");

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Published events show on the member calendar."
        actions={
          mayManage ? (
            <Link href="/admin/events/new">
              <Button>New event</Button>
            </Link>
          ) : null
        }
      />

      <Section title={`${events.length} event${events.length === 1 ? "" : "s"}`}>
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <Th>Event</Th>
                <Th>Kind</Th>
                <Th>Status</Th>
                <Th>Starts</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.length === 0 ? (
                <EmptyRow colSpan={5}>No events yet.</EmptyRow>
              ) : (
                events.map((event) => (
                  <tr key={event.id} className="hover:bg-surface">
                    <Td>
                      {mayManage ? (
                        <Link
                          href={`/admin/events/${event.id}/edit`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {event.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{event.title}</span>
                      )}
                      <span className="mt-0.5 block text-xs text-ink-faint">
                        {event.location_name ?? "No location set"}
                      </span>
                    </Td>
                    <Td className="text-ink-muted">{EVENT_KIND_LABELS[event.kind]}</Td>
                    <Td>
                      <Badge emphasis={event.status === "published" ? "strong" : "normal"}>
                        {EVENT_STATUS_LABELS[event.status]}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-muted">
                      {event.all_day
                        ? formatDenver(event.starts_at, {
                            hour: undefined,
                            minute: undefined,
                            timeZoneName: undefined,
                          }) + ", all day"
                        : formatDenver(event.starts_at)}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        {mayManage ? (
                          <>
                            {nextEventStatuses(event.status).map((target) => (
                              <form key={target} action={setEventStatus}>
                                <input type="hidden" name="eventId" value={event.id} />
                                <input type="hidden" name="status" value={target} />
                                <SubmitButton variant="secondary">
                                  {eventTransitionLabel(event.status, target)}
                                </SubmitButton>
                              </form>
                            ))}
                            <form action={deleteEventAction}>
                              <input type="hidden" name="eventId" value={event.id} />
                              <SubmitButton
                                variant="danger"
                                pendingLabel="Deleting"
                                confirm={
                                  event.status === "published"
                                    ? `Delete "${event.title}"? It is on the member calendar right now, and this cannot be undone.`
                                    : `Delete "${event.title}"? This cannot be undone.`
                                }
                              >
                                Delete event
                              </SubmitButton>
                            </form>
                          </>
                        ) : null}
                      </div>
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
