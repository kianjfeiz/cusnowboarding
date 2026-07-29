"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  EVENT_KINDS,
  canTransitionEvent,
  eventAuditAction,
  getEvent,
  insertEvent,
  isDuplicateSlug,
  slugifyEvent,
  updateEventRecord,
  updateEventStatus,
  validateEventWindow,
  type ClubEventKind,
  type ClubEventStatus,
  type EventInput,
} from "@/lib/events";
import { requireCapability } from "../_lib/actor";
import { recordAudit } from "../_lib/audit";
import { parseDenverInput } from "../_lib/datetime";

export interface EventFormState {
  error?: string;
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

type Parsed = { ok: true; value: EventInput } | { ok: false; error: string };

function parseEventForm(formData: FormData): Parsed {
  const title = text(formData, "title");
  if (!title) return { ok: false, error: "Title is required." };

  const slug = slugifyEvent(text(formData, "slug") || title);
  if (!slug) return { ok: false, error: "Could not derive a URL slug from that title." };

  const kind = text(formData, "kind") as ClubEventKind;
  if (!EVENT_KINDS.includes(kind)) return { ok: false, error: "Pick a kind for this event." };

  const startsAt = parseDenverInput(text(formData, "startsAt"));
  if (!startsAt) return { ok: false, error: "Start date and time are required." };

  const endsAt = parseDenverInput(text(formData, "endsAt"));
  const windowError = validateEventWindow(startsAt, endsAt);
  if (windowError) return { ok: false, error: windowError };

  return {
    ok: true,
    value: {
      slug,
      title,
      kind,
      description: text(formData, "description") || null,
      locationName: text(formData, "locationName") || null,
      address: text(formData, "address") || null,
      mapUrl: text(formData, "mapUrl") || null,
      startsAt,
      endsAt,
      allDay: formData.get("allDay") === "on",
      isTwentyOnePlus: formData.get("isTwentyOnePlus") === "on",
    },
  };
}

export async function createEvent(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const actor = await requireCapability("manageEvents");

  const parsed = parseEventForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;

  let eventId: string;
  try {
    eventId = await insertEvent(v, actor.boardUserId);
  } catch (error) {
    if (isDuplicateSlug(error)) return { error: `The URL slug "${v.slug}" is already taken.` };
    throw error;
  }

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "event.create",
    entityType: "event",
    entityId: eventId,
    data: { slug: v.slug, title: v.title, kind: v.kind, startsAt: v.startsAt },
  });

  revalidatePath("/admin/events");
  revalidatePath("/calendar");
  redirect("/admin/events");
}

export async function updateEvent(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const actor = await requireCapability("manageEvents");

  const eventId = text(formData, "eventId");
  if (!eventId) return { error: "Missing event id." };

  const parsed = parseEventForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;

  let found: boolean;
  try {
    found = await updateEventRecord(eventId, v);
  } catch (error) {
    if (isDuplicateSlug(error)) return { error: `The URL slug "${v.slug}" is already taken.` };
    throw error;
  }
  if (!found) return { error: "That event no longer exists." };

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "event.update",
    entityType: "event",
    entityId: eventId,
    data: { slug: v.slug, title: v.title, kind: v.kind, startsAt: v.startsAt },
  });

  revalidatePath("/admin/events");
  revalidatePath("/calendar");
  redirect("/admin/events");
}

export async function setEventStatus(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageEvents");

  const eventId = String(formData.get("eventId") ?? "");
  const target = String(formData.get("status") ?? "") as ClubEventStatus;

  const event = await getEvent(eventId);
  if (!event) throw new Error("Event not found");

  if (!canTransitionEvent(event.status, target)) {
    throw new Error(`Cannot move a ${event.status} event to ${target}`);
  }

  await updateEventStatus(eventId, target);

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: eventAuditAction(event.status, target),
    entityType: "event",
    entityId: eventId,
    data: { from: event.status, to: target, slug: event.slug },
  });

  revalidatePath("/admin/events");
  revalidatePath("/calendar");
}
