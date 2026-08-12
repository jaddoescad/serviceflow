import { PageHeader } from "@/components/kpi";
import { LeadsTable } from "@/components/leads-table";
import { getMarketingLeads } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const leads = await getMarketingLeads();

  return (
    <>
      <PageHeader
        title="Leads & Estimates"
        subtitle={`${leads.length.toLocaleString("en-CA")} leads from All Leads, matched to DripJobs with auditable evidence`}
      />
      <LeadsTable leads={leads} />
    </>
  );
}
