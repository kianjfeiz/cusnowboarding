"use server";

import { revalidatePath } from "next/cache";
import { execute } from "@/lib/db";
import { ROLE_KEYS, currentTermYear, type RoleKey } from "@/lib/authz";
import { waiveBoardDues } from "@/lib/dues";
import { requireCapability } from "../_lib/actor";
import { recordAudit } from "../_lib/audit";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function refreshSettings(): void {
  revalidatePath("/admin/settings");
}

type BoardUserContext = { email: string; is_active: boolean; is_superadmin: boolean };

async function loadBoardUser(id: string): Promise<BoardUserContext> {
  const rows = await execute<BoardUserContext>(
    `select email::text as email, is_active, is_superadmin from board_users where id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error("Board user not found");
  return row;
}

/**
 * `manageBoard` is granted by the superadmin flag alone, and nothing in this app
 * clears that flag - so the only route to zero superadmins is deactivating the
 * last one. Refusing that here is what keeps the club out of a state where
 * nobody can add a board member without a psql session.
 */
async function assertAnotherSuperadminRemains(boardUserId: string): Promise<void> {
  const rows = await execute<{ others: number }>(
    `select count(*)::int as others
       from board_users
      where is_active and is_superadmin and id <> $1`,
    [boardUserId],
  );
  if ((rows[0]?.others ?? 0) === 0) {
    throw new Error(
      "That is the last active superadmin. Someone else has to hold it before this account can be deactivated.",
    );
  }
}

// ---------------------------------------------------------------------------
// Board users
// ---------------------------------------------------------------------------

export interface BoardUserFormState {
  error?: string;
  added?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function addBoardUser(
  _prev: BoardUserFormState,
  formData: FormData,
): Promise<BoardUserFormState> {
  const actor = await requireCapability("manageBoard");

  const email = text(formData, "email").toLowerCase();
  if (!EMAIL.test(email)) return { error: "That does not look like an email address." };

  const name = text(formData, "name") || null;

  // Emails are citext, so the conflict catches a differently-cased duplicate too.
  const rows = await execute<{ id: string }>(
    `insert into board_users (email, name) values ($1, $2)
     on conflict (email) do nothing
     returning id`,
    [email, name],
  );

  const created = rows[0];
  if (!created) {
    return {
      error: `${email} is already a board user. If they are inactive, reactivate them below.`,
    };
  }

  // Joining the board settles this season's dues. A no-op until they have
  // signed in at least once; linkGoogleMember catches them up when they do.
  const duesWaived = await waiveBoardDues(email);

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "board_user.add",
    entityType: "board_user",
    entityId: created.id,
    data: { email, name, duesWaived },
  });

  refreshSettings();
  return { added: email };
}

export async function setBoardUserActive(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageBoard");

  const boardUserId = text(formData, "boardUserId");
  const active = text(formData, "active") === "true";
  const target = await loadBoardUser(boardUserId);

  if (!active && target.is_superadmin) await assertAnotherSuperadminRemains(boardUserId);

  await execute(`update board_users set is_active = $2 where id = $1`, [boardUserId, active]);

  // Reactivation restores the dues waiver. Deactivation deliberately does not
  // claw one back - the season was served; "Clear dues" is the manual override.
  const duesWaived = active ? await waiveBoardDues(target.email) : 0;

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: active ? "board_user.reactivate" : "board_user.deactivate",
    entityType: "board_user",
    entityId: boardUserId,
    data: { email: target.email, self: boardUserId === actor.boardUserId, duesWaived },
  });

  refreshSettings();
}

// ---------------------------------------------------------------------------
// Role assignment
// ---------------------------------------------------------------------------

const KNOWN_ROLES = new Set<string>(ROLE_KEYS);

function parseRole(formData: FormData): { roleKey: RoleKey; termYear: number } {
  const roleKey = text(formData, "roleKey");
  if (!KNOWN_ROLES.has(roleKey)) throw new Error(`Unknown role: ${roleKey}`);

  const termYear = Number(text(formData, "termYear"));
  const thisTerm = currentTermYear();
  if (!Number.isInteger(termYear) || termYear < 2015 || termYear > thisTerm + 5) {
    throw new Error("Term year is out of range.");
  }

  return { roleKey: roleKey as RoleKey, termYear };
}

export async function assignRole(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageBoard");

  const boardUserId = text(formData, "boardUserId");
  const { roleKey, termYear } = parseRole(formData);
  const target = await loadBoardUser(boardUserId);

  await execute(
    `insert into board_user_roles (board_user_id, role_key, term_year)
     values ($1, $2, $3)
     on conflict do nothing`,
    [boardUserId, roleKey, termYear],
  );

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "board_role.assign",
    entityType: "board_user",
    entityId: boardUserId,
    data: { email: target.email, roleKey, termYear },
  });

  refreshSettings();
}

export async function removeRole(formData: FormData): Promise<void> {
  const actor = await requireCapability("manageBoard");

  const boardUserId = text(formData, "boardUserId");
  const { roleKey, termYear } = parseRole(formData);
  const target = await loadBoardUser(boardUserId);

  // Roles never grant manageBoard, so removing one cannot lock anybody out; the
  // superadmin guard belongs on deactivation only.
  await execute(
    `delete from board_user_roles
      where board_user_id = $1 and role_key = $2 and term_year = $3`,
    [boardUserId, roleKey, termYear],
  );

  await recordAudit({
    actorBoardUserId: actor.boardUserId,
    action: "board_role.remove",
    entityType: "board_user",
    entityId: boardUserId,
    data: { email: target.email, roleKey, termYear },
  });

  refreshSettings();
}
