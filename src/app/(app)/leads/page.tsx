import { PageHeader } from "@/components/kpi";
import { LeadsTable } from "@/components/leads-table";
import { getLeadEstimates } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const leads = await getLeadEstimates();
  const withoutAddress = leads.filter((lead) => !lead.hasStreetAddress).length;
  const estimatesStarted = leads.filter((lead) => lead.estimateUpdatedAt).length;

  return (
    <>
      <PageHeader
        title="Leads & Estimates"
        subtitle={`${leads.length} active CompanyCam leads · ${withoutAddress} without a street address · ${estimatesStarted} estimates started`}
      />
      <LeadsTable leads={leads} />
    </>
  );
}
