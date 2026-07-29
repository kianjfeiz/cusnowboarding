import { PageHeader } from "@/components/admin/shell";
import { requireCapability } from "../../_lib/actor";
import { toDenverInput } from "../../_lib/datetime";
import { createEvent } from "../actions";
import { EventForm } from "../event-form";

export const dynamic = "force-dynamic";

/** Next Friday at 8pm Mountain - the default is a party, because most of them are. */
function defaultStart(): Date {
  const now = new Date();
  const days = (5 - now.getDay() + 7) % 7 || 7;
  const start = new Date(now);
  start.setDate(start.getDate() + days);
  start.setHours(20, 0, 0, 0);
  return start;
}

export default async function NewEventPage() {
  await requireCapability("manageEvents");

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New event"
        subtitle="Saved as a draft. Publish it when you want members to see it."
        back={{ href: "/admin/events", label: "Back to events" }}
      />

      <EventForm
        action={createEvent}
        submitLabel="Create draft"
        cancelHref="/admin/events"
        defaults={{
          title: "",
          slug: "",
          kind: "party",
          description: "",
          locationName: "",
          address: "",
          mapUrl: "",
          startsAt: toDenverInput(defaultStart()),
          endsAt: "",
          allDay: false,
          isTwentyOnePlus: false,
        }}
      />
    </div>
  );
}
