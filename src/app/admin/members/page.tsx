import Link from "next/link";
import { EmptyRow, PageHeader, Section, TableWrap, Td, Th } from "@/components/admin/shell";
import { SubmitButton } from "@/components/admin/submit-button";
import { Badge, Button, Input, formatDenver } from "@/components/ui";
import { can } from "@/lib/authz";
import { requireCapability } from "../_lib/actor";
import { listMembers } from "../_lib/queries";
import { setMemberBlocked, setMemberDues, setMemberVerified } from "./actions";
import { DuesImport } from "./dues-import";

export const dynamic = "force-dynamic";

const LIMIT = 100;

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const actor = await requireCapability("viewRosters");

  const { q } = await searchParams;
  const search = (q ?? "").trim();
  const members = await listMembers(search, LIMIT);

  const mayManageBoard = can(actor, "manageBoard");
  const mayManagePayments = can(actor, "managePayments");
  const showActions = mayManageBoard || mayManagePayments;

  return (
    <>
      <PageHeader
        title="Members"
        subtitle="Everyone who has given the club an email address. Members are created by signing up, not here."
      />

      <Section
        title={
          search
            ? `${members.length} matching "${search}"`
            : `${members.length} members, newest first`
        }
        description={
          members.length === LIMIT
            ? `Showing the first ${LIMIT}. Search to narrow it down.`
            : undefined
        }
        actions={
          <form method="get" className="flex items-center gap-2">
            <Input
              name="q"
              defaultValue={search}
              placeholder="Name or email"
              aria-label="Search members"
              className="h-8 w-56 text-xs"
            />
            <Button type="submit" variant="secondary" className="h-8 px-3 text-xs">
              Search
            </Button>
            {search ? (
              <Link
                href="/admin/members"
                className="text-xs text-ink-muted underline underline-offset-4 hover:text-ink"
              >
                Clear
              </Link>
            ) : null}
          </form>
        }
      >
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <Th>Member</Th>
                <Th>Phone</Th>
                <Th>Verified</Th>
                <Th>Dues</Th>
                <Th>Access</Th>
                <Th className="text-right">Signups</Th>
                <Th className="text-right">Paid</Th>
                {showActions ? <Th /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.length === 0 ? (
                <EmptyRow colSpan={showActions ? 8 : 7}>
                  {search ? "No member matches that search." : "No members yet."}
                </EmptyRow>
              ) : (
                members.map((member) => (
                  <tr key={member.id} className="hover:bg-surface">
                    <Td>
                      <span className="font-medium">
                        {member.first_name} {member.last_name}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-faint">
                        {member.email}
                      </span>
                    </Td>
                    <Td className="tnum whitespace-nowrap text-ink-muted">
                      {member.phone ?? "-"}
                    </Td>
                    <Td>
                      {member.email_verified_at ? (
                        <span title={`Verified ${formatDenver(member.email_verified_at)}`}>
                          <Badge emphasis="muted">Verified</Badge>
                        </span>
                      ) : (
                        <Badge>Not verified</Badge>
                      )}
                    </Td>
                    <Td>
                      {member.is_club_member ? (
                        <Badge emphasis="muted">Dues paid</Badge>
                      ) : (
                        <Badge>No dues</Badge>
                      )}
                    </Td>
                    <Td>
                      {member.is_blocked ? (
                        <Badge emphasis="strong">Blocked</Badge>
                      ) : (
                        <Badge emphasis="muted">Allowed</Badge>
                      )}
                    </Td>
                    <Td className="tnum text-right text-ink-muted">
                      <span title={member.trip_titles ?? undefined}>{member.trip_count}</span>
                    </Td>
                    <Td className="tnum text-right text-ink-muted">{member.paid_count}</Td>
                    {showActions ? (
                      <Td>
                        <div className="flex flex-wrap justify-end gap-2">
                          {mayManagePayments ? (
                            <form action={setMemberDues}>
                              <input type="hidden" name="memberId" value={member.id} />
                              <input
                                type="hidden"
                                name="paid"
                                value={member.is_club_member ? "false" : "true"}
                              />
                              <SubmitButton variant="secondary">
                                {member.is_club_member ? "Clear dues" : "Mark dues paid"}
                              </SubmitButton>
                            </form>
                          ) : null}

                          {mayManageBoard ? (
                            <form action={setMemberVerified}>
                              <input type="hidden" name="memberId" value={member.id} />
                              <input
                                type="hidden"
                                name="verified"
                                value={member.email_verified_at ? "false" : "true"}
                              />
                              <SubmitButton
                                variant={member.email_verified_at ? "danger" : "secondary"}
                                confirm={
                                  member.email_verified_at
                                    ? `Clear verification for ${member.email}? They will be signed out and have to verify again before claiming a spot.`
                                    : undefined
                                }
                              >
                                {member.email_verified_at ? "Unverify" : "Mark verified"}
                              </SubmitButton>
                            </form>
                          ) : null}

                          {mayManageBoard ? (
                            <form action={setMemberBlocked}>
                              <input type="hidden" name="memberId" value={member.id} />
                              <input
                                type="hidden"
                                name="blocked"
                                value={member.is_blocked ? "false" : "true"}
                              />
                              <SubmitButton
                                variant={member.is_blocked ? "secondary" : "danger"}
                                confirm={
                                  member.is_blocked
                                    ? undefined
                                    : `Block ${member.email}? They are signed out immediately and cannot claim a spot.`
                                }
                              >
                                {member.is_blocked ? "Unblock" : "Block"}
                              </SubmitButton>
                            </form>
                          ) : null}
                        </div>
                      </Td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      {mayManagePayments ? (
        <div className="mt-6">
          <Section
            title="Import dues"
            description="Marks matching members as paid. Never creates a member - unknown addresses are listed back to you."
          >
            <DuesImport />
          </Section>
        </div>
      ) : null}
    </>
  );
}
