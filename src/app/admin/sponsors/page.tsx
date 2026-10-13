import { PageHeader } from "@/components/admin/shell";
import { can } from "@/lib/auth/authz";
import { listSponsors } from "@/lib/sponsors/sponsors";
import { requireActor } from "../_lib/actor";
import { NewSponsor, SponsorCard } from "./sponsor-card";

export const dynamic = "force-dynamic";

export default async function AdminSponsorsPage() {
  const actor = await requireActor();
  const sponsors = await listSponsors();
  const mayManage = can(actor, "manageSponsors");

  return (
    <>
      <PageHeader title="Sponsors" subtitle="Members see these on the Sponsors tab." />

      <div className="space-y-4">
        {mayManage ? <NewSponsor startOpen={sponsors.length === 0} /> : null}

        {sponsors.length === 0 && !mayManage ? (
          <p className="text-sm text-ink-muted">No sponsors yet.</p>
        ) : null}

        {sponsors.length > 0 ? (
          <ul className="space-y-4">
            {sponsors.map((sponsor) => (
              <SponsorCard key={sponsor.id} sponsor={sponsor} mayManage={mayManage} />
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}
