import { PageHeader, Section } from "@/components/admin/shell";
import { SubmitButton } from "@/components/admin/submit-button";
import { Badge, Notice, formatDenver } from "@/components/ui";
import { can, currentTermYear } from "@/lib/authz";
import { requireActor } from "../_lib/actor";
import { listBoardRoles, listBoardUsers, type BoardUserRow } from "../_lib/queries";
import { AddBoardUser } from "./add-board-user";
import { assignRole, removeRole, setBoardUserActive } from "./actions";

export const dynamic = "force-dynamic";

/** 2026 is the 2026-27 board. Writing it out avoids a year of "is that the start or the end?". */
function termLabel(year: number): string {
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

/**
 * Roles are stored per term year, but the board never has to think in those
 * terms: last season's roles stop granting anything on their own, so the screen
 * shows only the ones in force and assigns to the current season. One row per
 * role key, keeping the earliest term still in force, because that is the row
 * doing the granting.
 */
function rolesInForce(
  roles: BoardUserRow["roles"],
  thisTerm: number,
): Array<{ key: string; termYear: number }> {
  const held = new Map<string, number>();
  for (const role of roles) {
    if (role.termYear < thisTerm) continue;
    const existing = held.get(role.key);
    if (existing === undefined || role.termYear < existing) held.set(role.key, role.termYear);
  }
  return [...held.entries()].map(([key, termYear]) => ({ key, termYear }));
}

export default async function SettingsPage() {
  const actor = await requireActor();

  if (!can(actor, "manageBoard")) {
    return (
      <>
        <PageHeader title="Settings" subtitle="Who can sign in to the board tool." />
        <Notice tone="alert" title="Not permitted">
          Only a superadmin can add board users or change roles. Ask the president if you
          need something changed here.
        </Notice>
      </>
    );
  }

  const [users, roles] = await Promise.all([listBoardUsers(), listBoardRoles()]);
  const thisTerm = currentTermYear();
  const roleLabels = new Map(roles.map((role) => [role.key, role.label]));
  const activeSuperadmins = users.filter((u) => u.is_active && u.is_superadmin).length;

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={`Who can sign in to the board tool, and what each of them can do. Roles below are for the ${termLabel(thisTerm)} season; older ones have already stopped granting anything.`}
      />

      <Section title={`${users.length} board users`}>
        <ul className="divide-y divide-border">
          {users.map((user) => {
            const held = rolesInForce(user.roles, thisTerm);
            const isLastSuperadmin =
              user.is_active && user.is_superadmin && activeSuperadmins === 1;

            return (
              <li key={user.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{user.name ?? user.email}</span>
                      {user.is_superadmin ? <Badge emphasis="strong">Superadmin</Badge> : null}
                      {user.is_active ? null : <Badge>Inactive</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-faint">{user.email}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <p className="text-xs text-ink-muted">
                      {user.last_login_at
                        ? `Last signed in ${formatDenver(user.last_login_at)}`
                        : "Has never signed in"}
                    </p>

                    <form action={setBoardUserActive}>
                      <input type="hidden" name="boardUserId" value={user.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={user.is_active ? "false" : "true"}
                      />
                      <SubmitButton
                        variant={user.is_active ? "danger" : "secondary"}
                        disabled={isLastSuperadmin}
                        title={
                          isLastSuperadmin
                            ? "The last active superadmin cannot be deactivated."
                            : undefined
                        }
                        confirm={
                          user.is_active
                            ? `Deactivate ${user.email}? They lose access to the board tool immediately.`
                            : undefined
                        }
                      >
                        {user.is_active ? "Deactivate" : "Reactivate"}
                      </SubmitButton>
                    </form>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  {held.length === 0 ? (
                    <span className="text-xs text-ink-faint">No role this season.</span>
                  ) : (
                    held.map(({ key, termYear }) => (
                      <span key={key} className="inline-flex items-center gap-1">
                        <Badge>{roleLabels.get(key) ?? key}</Badge>
                        <form action={removeRole}>
                          <input type="hidden" name="boardUserId" value={user.id} />
                          <input type="hidden" name="roleKey" value={key} />
                          <input type="hidden" name="termYear" value={termYear} />
                          <SubmitButton
                            variant="quiet"
                            className="h-6 px-1.5"
                            confirm={`Remove ${roleLabels.get(key) ?? key} from ${user.email}?`}
                          >
                            Remove
                          </SubmitButton>
                        </form>
                      </span>
                    ))
                  )}

                  {user.is_active ? (
                    <form action={assignRole} className="flex items-center gap-2">
                      <input type="hidden" name="boardUserId" value={user.id} />
                      {/* Always this season. A board that had to pick a year would
                          eventually pick the wrong one and wonder why nothing worked. */}
                      <input type="hidden" name="termYear" value={thisTerm} />
                      <select
                        name="roleKey"
                        aria-label={`Role for ${user.email}`}
                        className="h-8 rounded-md border border-border bg-paper px-2 text-xs text-ink focus:border-accent focus:outline-none"
                        defaultValue={roles[0]?.key}
                      >
                        {roles.map((role) => (
                          <option key={role.key} value={role.key}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                      <SubmitButton>Add role</SubmitButton>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <div className="mt-6">
        <Section
          title="Add a board user"
          description="There is no self-signup. An address that is not listed here is refused at sign-in."
        >
          <AddBoardUser />
        </Section>
      </div>
    </>
  );
}
