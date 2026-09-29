import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/shell";
import { EVENT_STATUS_LABELS, getEvent } from "@/lib/events/events";
import { requireCapability } from "../../../_lib/actor";
import { toDenverInput } from "../../../_lib/datetime";
import { updateEvent } from "../../actions";
import { EventForm } from "../../event-form";

export const dynamic = "force-dynamic";

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapability("manageEvents");

  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={`Edit ${event.title}`}
        subtitle={EVENT_STATUS_LABELS[event.status]}
        back={{ href: "/admin/events", label: "Events" }}
      />

      <EventForm
        action={updateEvent}
        submitLabel="Save changes"
        cancelHref="/admin/events"
        defaults={{
          id: event.id,
          title: event.title,
          kind: event.kind,
          description: event.description ?? "",
          locationName: event.location_name ?? "",
          address: event.address ?? "",
          mapUrl: event.map_url ?? "",
          startsAt: toDenverInput(event.starts_at),
          endsAt: toDenverInput(event.ends_at),
          allDay: event.all_day,
        }}
      />
    </div>
  );
}
