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

function groupRolesByTerm(roles: BoardUserRow["roles"]): Array<[number, string[]]> {
  const byTerm = new Map<number, string[]>();
  for (const role of roles) {
    const bucket = byTerm.get(role.termYear);
    if (bucket) bucket.push(role.key);
    else byTerm.set(role.termYear, [role.key]);
  }
  return [...byTerm.entries()].sort((a, b) => b[0] - a[0]);
}

const controlClass =
  "h-8 rounded-md border border-border bg-paper px-2 text-xs text-ink focus:border-accent focus:outline-none";

export default async function SettingsPage() {
  const actor = await requireActor();

  if (!can(actor, "manageBoard")) {
    return (
      <>
        <PageHeader title="Settings" subtitle="Board users and role assignments." />
        <Notice tone="alert" title="Not permitted">
          Only a superadmin can add board users or change role assignments. Ask the
          president if you need something changed here.
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
        subtitle={`Board users and role assignments. Roles are scoped to a term year; ${termLabel(thisTerm)} is the one that grants anything today.`}
      />

      <Section
        title={`${users.length} board users`}
        description="Removing someone takes effect on their next page load, not at token expiry."
      >
        <ul className="divide-y divide-border">
          {users.map((user) => {
            const grouped = groupRolesByTerm(user.roles);
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

                <div className="mt-3 space-y-1.5">
                  {grouped.length === 0 ? (
                    <p className="text-xs text-ink-faint">No roles assigned.</p>
                  ) : (
                    grouped.map(([year, keys]) => (
                      <div key={year} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span className="tnum w-16 shrink-0 text-xs text-ink-faint">
                          {termLabel(year)}
                        </span>
                        {keys.map((key) => (
                          <span key={key} className="inline-flex items-center gap-1">
                            <Badge emphasis={year >= thisTerm ? "normal" : "muted"}>
                              {roleLabels.get(key) ?? key}
                            </Badge>
                            <form action={removeRole}>
                              <input type="hidden" name="boardUserId" value={user.id} />
                              <input type="hidden" name="roleKey" value={key} />
                              <input type="hidden" name="termYear" value={year} />
                              <SubmitButton
                                variant="quiet"
                                className="h-6 px-1.5"
                                confirm={`Remove ${roleLabels.get(key) ?? key} (${termLabel(year)}) from ${user.email}?`}
                              >
                                Remove
                              </SubmitButton>
                            </form>
                          </span>
                        ))}
                      </div>
                    ))
                  )}

                  {user.is_active ? (
                    <form
                      action={assignRole}
                      className="flex flex-wrap items-center gap-2 pt-1"
                    >
                      <input type="hidden" name="boardUserId" value={user.id} />
                      <select
                        name="roleKey"
                        aria-label={`Role for ${user.email}`}
                        className={controlClass}
                        defaultValue={roles[0]?.key}
                      >
                        {roles.map((role) => (
                          <option key={role.key} value={role.key}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        name="termYear"
                        aria-label={`Term year for ${user.email}`}
                        defaultValue={thisTerm}
                        min={2015}
                        max={thisTerm + 5}
                        step={1}
                        className={`${controlClass} tnum w-24`}
                      />
                      <SubmitButton>Assign role</SubmitButton>
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
