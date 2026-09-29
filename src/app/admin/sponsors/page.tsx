import { PageHeader, Section } from "@/components/admin/shell";
import { SubmitButton } from "@/components/admin/submit-button";
import { Field, Input } from "@/components/ui";
import { can } from "@/lib/auth/authz";
import { listSponsors } from "@/lib/sponsors/sponsors";
import { requireActor } from "../_lib/actor";
import { addSponsorCode, deleteSponsor, removeSponsorCode } from "./actions";
import { SponsorForm } from "./sponsor-form";

export const dynamic = "force-dynamic";

export default async function AdminSponsorsPage() {
  const actor = await requireActor();
  const sponsors = await listSponsors();
  const mayManage = can(actor, "manageSponsors");

  return (
    <>
      <PageHeader title="Sponsors" subtitle="Members see these on the Sponsors tab." />

      <div className="space-y-6">
        {mayManage ? (
          <Section title="Add a sponsor">
            <div className="p-5">
              <SponsorForm submitLabel="Add sponsor" />
            </div>
          </Section>
        ) : null}

        {sponsors.length === 0 ? (
          <p className="rounded-lg border border-border bg-paper px-5 py-8 text-center text-sm text-ink-muted">
            No sponsors yet.
          </p>
        ) : null}

        {sponsors.map((sponsor) => (
          <Section
            key={sponsor.id}
            title={sponsor.name}
            description={
              sponsor.websiteUrl ? (
                <a
                  href={sponsor.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-ink"
                >
                  {new URL(sponsor.websiteUrl).host}
                </a>
              ) : null
            }
            actions={
              mayManage ? (
                <form action={deleteSponsor}>
                  <input type="hidden" name="sponsorId" value={sponsor.id} />
                  <SubmitButton
                    variant="danger"
                    pendingLabel="Removing"
                    confirm={`Remove ${sponsor.name}${
                      sponsor.codes.length > 0
                        ? ` and its ${sponsor.codes.length} code${sponsor.codes.length === 1 ? "" : "s"}`
                        : ""
                    }? Members stop seeing it right away.`}
                  >
                    Remove sponsor
                  </SubmitButton>
                </form>
              ) : null
            }
          >
            {sponsor.description ? (
              <p className="px-5 pt-4 text-sm text-ink-muted">{sponsor.description}</p>
            ) : null}

            {sponsor.codes.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-faint">No codes yet.</p>
            ) : (
              <ul className="divide-y divide-border px-5 py-2">
                {sponsor.codes.map((code) => (
                  <li key={code.id} className="flex items-center justify-between gap-4 py-2.5">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-sm font-semibold text-ink">
                        {code.code}
                      </p>
                      {code.details ? (
                        <p className="mt-0.5 text-xs text-ink-muted">{code.details}</p>
                      ) : null}
                    </div>
                    {mayManage ? (
                      <form action={removeSponsorCode}>
                        <input type="hidden" name="codeId" value={code.id} />
                        <SubmitButton
                          variant="quiet"
                          pendingLabel="Removing"
                          confirm={`Remove the code ${code.code}?`}
                        >
                          Remove code
                        </SubmitButton>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {mayManage ? (
              <>
                <form
                  action={addSponsorCode}
                  className="grid gap-3 border-t border-border px-5 py-4 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end"
                >
                  <input type="hidden" name="sponsorId" value={sponsor.id} />
                  <Field label="Code">
                    <Input name="code" required maxLength={80} autoComplete="off" />
                  </Field>
                  <Field label="What it gets you">
                    <Input name="details" maxLength={200} autoComplete="off" />
                  </Field>
                  <SubmitButton pendingLabel="Adding" className="h-10 px-4 text-sm">
                    Add code
                  </SubmitButton>
                </form>

                <details className="border-t border-border">
                  <summary className="cursor-pointer px-5 py-3 text-sm text-ink-muted hover:text-ink">
                    Edit details
                  </summary>
                  <div className="px-5 pb-5">
                    <SponsorForm sponsor={sponsor} submitLabel="Save" />
                  </div>
                </details>
              </>
            ) : null}
          </Section>
        ))}
      </div>
    </>
  );
}
