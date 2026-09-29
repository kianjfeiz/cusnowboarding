import Link from "next/link";
import { DataTable, PageHeader, Section, Td } from "@/components/admin/shell";
import { SubmitButton } from "@/components/admin/submit-button";
import { Badge, Button, Input, formatMoney } from "@/components/ui";
import { can } from "@/lib/auth/authz";
import { getDuesStatusFor, type DuesStatus } from "@/lib/money/dues";
import { requireCapability } from "../_lib/actor";
import { listMembers } from "../_lib/queries";

/** listMembers' default page size: a full page means there may be more. */
const PAGE = 100;
import { setMemberBlocked, setMemberDues } from "./actions";
import { DuesImport } from "./dues-import";

export const dynamic = "force-dynamic";

/**
 * The rate, not just the state: returning members pay half, and the treasurer
 * has no other way to know which someone is. A waiver never reads as "Paid",
 * which would send the treasurer hunting for money that never arrived.
 */
function duesCaption(status: DuesStatus | undefined): string | null {
  if (!status) return null;
  if (status.waivedThisSeason) return "Board";
  if (status.paidThisSeason) return status.returning ? "Returning" : "First season";
  return `Owes ${formatMoney(status.owedCents)} · ${
    status.returning ? "returning rate" : "first-season rate"
  }`;
}

/**
 * Four jobs: find a person, see whether their dues are recorded, keep someone
 * out, and import dues in bulk. Anything else about a member belongs on the
 * trip they are on.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const actor = await requireCapability("viewRosters");

  const { q } = await searchParams;
  const search = (q ?? "").trim();
  const members = await listMembers(search, PAGE);
  // One query for the page rather than one per row.
  const dues = await getDuesStatusFor(members.map((m) => m.id));

  const mayBlock = can(actor, "manageMembers");
  const mayManagePayments = can(actor, "managePayments");
  const showActions = mayBlock || mayManagePayments;

  return (
    <>
      <PageHeader title="Members" />

      {/* Side by side on a wide screen, so the import is not buried under a
          hundred rows. */}
      <div
        className={
          mayManagePayments
            ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"
            : undefined
        }
      >
        <Section
          title={
            search
              ? `${members.length}${members.length === PAGE ? "+" : ""} matching "${search}"`
              : members.length === PAGE
                ? `Newest ${PAGE} members`
                : `${members.length} members, newest first`
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
          <DataTable
            columns={["Member", "Dues", ...(showActions ? [""] : [])]}
            empty={search ? "No member matches that search." : "No members yet."}
          >
            {members.map((member) => (
              <tr key={member.id} className="hover:bg-surface">
                <Td>
                  <span className="font-medium">
                    {member.first_name} {member.last_name}
                  </span>
                  {member.is_blocked ? (
                    <span className="ml-2">
                      <Badge emphasis="strong">Blocked</Badge>
                    </span>
                  ) : null}
                  <span className="mt-0.5 block text-xs text-ink-faint">{member.email}</span>
                </Td>
                <Td>
                  {member.is_club_member ? (
                    <Badge emphasis="muted">
                      {dues.get(member.id)?.waivedThisSeason ? "Waived" : "Paid"}
                    </Badge>
                  ) : (
                    <Badge>Not paid</Badge>
                  )}
                  <span className="mt-0.5 block text-xs text-ink-faint">
                    {duesCaption(dues.get(member.id))}
                  </span>
                </Td>
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

                      {mayBlock ? (
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
            ))}
          </DataTable>
        </Section>

        {mayManagePayments ? (
          <Section
            title="Import dues"
            description="Marks matching members' dues as paid. Unknown addresses are listed back; nobody is created."
          >
            <DuesImport />
          </Section>
        ) : null}
      </div>
    </>
  );
}
