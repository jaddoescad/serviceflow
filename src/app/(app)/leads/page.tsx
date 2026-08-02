import { PageHeader } from "@/components/kpi";
import { LeadsTable } from "@/components/leads-table";
import { Stat, StatGrid } from "@/components/ui";
import { getMarketingLeads } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const leads = await getMarketingLeads();
  const leads2026 = leads.filter((lead) => lead.createdOn.startsWith("2026-"));
  const meta2026 = leads2026.filter(
    (lead) => lead.normalizedChannel === "paid_social",
  ).length;
  const contactable2026 = leads2026.filter(
    (lead) => lead.email || lead.phone,
  ).length;
  const linked2026 = leads2026.filter(
    (lead) => lead.companyCamProjects.length > 0,
  ).length;

  return (
    <>
      <PageHeader
        title="Leads & Estimates"
        subtitle="All Leads is the canonical CRM source; project relationships are saved with auditable evidence"
      />
      <StatGrid columns={4} className="mb-4 rounded-[var(--radius)] border border-[var(--color-border)]">
        <Stat label="2026 leads" value={leads2026.length.toLocaleString("en-CA")} hint={`${leads.length.toLocaleString("en-CA")} all time`} />
        <Stat label="Meta leads" value={meta2026.toLocaleString("en-CA")} hint={`${((meta2026 / Math.max(leads2026.length, 1)) * 100).toFixed(1)}% of 2026 leads`} />
        <Stat label="Contactable" value={contactable2026.toLocaleString("en-CA")} hint="Has an email or phone" />
        <Stat label="CompanyCam linked" value={linked2026.toLocaleString("en-CA")} hint="Persisted exact identifier relationships" />
      </StatGrid>
      <LeadsTable leads={leads} />
    </>
  );
}
