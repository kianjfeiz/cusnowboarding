"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { sponsorCodes, sponsors } from "@/lib/db/schema";
import { normalizeWebsite } from "@/lib/sponsors/sponsors";
import { requireCapability } from "../_lib/actor";
import { recordAudit } from "../_lib/audit";
import { text } from "../_lib/form";

export interface SponsorFormState {
  error?: string;
}

function refresh(): void {
  revalidatePath("/sponsors");
  revalidatePath("/admin/sponsors");
}

/** Creates a sponsor, or updates one when the form carries a sponsorId. */
export async function saveSponsor(
  _prev: SponsorFormState,
  formData: FormData,
): Promise<SponsorFormState> {
  const actor = await requireCapability("manageSponsors");

  const name = text(formData, "name");
  if (!name) return { error: "Name is required." };
  if (name.length > 120) return { error: "Keep the name under 120 characters." };

  const websiteUrl = normalizeWebsite(text(formData, "websiteUrl"));
  if (websiteUrl === undefined) return { error: "That website is not a web address." };

  const description = text(formData, "description") || null;
  if (description && description.length > 500) {
    return { error: "Keep the description under 500 characters." };
  }

  const values = { name, websiteUrl, description };
  const sponsorId = text(formData, "sponsorId");

  if (sponsorId) {
    const updated = await db
      .update(sponsors)
      .set(values)
      .where(eq(sponsors.id, sponsorId))
      .returning({ id: sponsors.id });
    if (updated.length === 0) return { error: "That sponsor no longer exists." };
    await recordAudit({
      actorBoardUserId: actor.boardUserId,
      action: "sponsor.update",
      entityType: "sponsor",
      entityId: sponsorId,
      data: values,
    });
  } else {
    const [created] = await db
      .insert(sponsors)
      .values({ ...values, createdBy: actor.boardUserId })
      .returning({ id: sponsors.id });
    await recordAudit({
      actorBoardUserId: actor.boardUserId,
      action: "sponsor.create",
      entityType: "sponsor",
      entityId: created.id,
      data: values,
    });
  }

  refresh();
  return {};
}

export async function deleteSponsor(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageSponsors");

  const sponsorId = text(formData, "sponsorId");
  const [removed] = await db
    .delete(sponsors)
    .where(eq(sponsors.id, sponsorId))
    .returning({ name: sponsors.name });
  if (!removed) return;

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "sponsor.delete",
    entityType: "sponsor",
    entityId: sponsorId,
    data: { name: removed.name },
  });
  refresh();
}

export async function addSponsorCode(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageSponsors");

  const sponsorId = text(formData, "sponsorId");
  const code = text(formData, "code");
  const details = text(formData, "details") || null;
  if (!code || code.length > 80) throw new Error("A code is required, under 80 characters.");
  if (details && details.length > 200) throw new Error("Keep the details under 200 characters.");

  const [sponsor] = await db
    .select({ id: sponsors.id })
    .from(sponsors)
    .where(eq(sponsors.id, sponsorId));
  if (!sponsor) throw new Error("Sponsor not found");

  const [created] = await db
    .insert(sponsorCodes)
    .values({ sponsorId, code, details })
    .returning({ id: sponsorCodes.id });

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "sponsor.code_add",
    entityType: "sponsor",
    entityId: sponsorId,
    data: { codeId: created.id, code, details },
  });
  refresh();
}

export async function removeSponsorCode(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageSponsors");

  const codeId = text(formData, "codeId");
  const [removed] = await db
    .delete(sponsorCodes)
    .where(eq(sponsorCodes.id, codeId))
    .returning({ sponsorId: sponsorCodes.sponsorId, code: sponsorCodes.code });
  if (!removed) return;

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "sponsor.code_remove",
    entityType: "sponsor",
    entityId: removed.sponsorId,
    data: { codeId, code: removed.code },
  });
  refresh();
}
