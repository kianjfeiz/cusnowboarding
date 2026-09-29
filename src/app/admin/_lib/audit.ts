import { execute } from "@/lib/db";

/**
 * Every board mutation leaves a row here: these are judgement calls made by one
 * person on behalf of the club, so "who did this and when" has to be answerable.
 */
export async function recordAudit(input: {
  actorBoardUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: unknown;
}): Promise<void> {
  await execute(
    `insert into audit_events (actor_board_user_id, action, entity_type, entity_id, data)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.actorBoardUserId,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.data === undefined ? null : JSON.stringify(input.data),
    ],
  );
}
