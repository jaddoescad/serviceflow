import { PageHeader } from "@/components/kpi";
import { LeadsTable } from "@/components/leads-table";
import { getMarketingLeads } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const leads = await getMarketingLeads();

  return (
    <>
      <PageHeader
        title="Deals"
        subtitle={`${leads.length.toLocaleString("en-CA")} deals · contacts and linked jobs`}
      />
      <LeadsTable leads={leads} />
    </>
  );
}
