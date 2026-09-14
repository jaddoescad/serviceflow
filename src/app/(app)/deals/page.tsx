import { PageHeader } from "@/components/kpi";
import { LeadsTable } from "@/components/leads-table";
import { getMarketingLeads } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const leads = await getMarketingLeads();

  return (
    <>
      <PageHeader
        title="Deals"
        subtitle={`${leads.length.toLocaleString("en-CA")} deals`}
      />
      <LeadsTable leads={leads} />
    </>
  );
}
