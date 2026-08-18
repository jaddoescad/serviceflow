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
        subtitle={`${leads.length.toLocaleString("en-CA")} projects · one lead, estimate, or current job per row`}
      />
      <LeadsTable leads={leads} />
    </>
  );
}
