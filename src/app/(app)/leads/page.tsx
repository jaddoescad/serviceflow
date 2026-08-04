import { PageHeader } from "@/components/kpi";
import { LeadsTable } from "@/components/leads-table";
import { Stat, StatGrid } from "@/components/ui";
import {
  getDripJobsLeadCoverage,
  getDripJobsSyncHealth,
  getMarketingLeads,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const [leads, jobCoverage, syncHealth] = await Promise.all([
    getMarketingLeads(),
    getDripJobsLeadCoverage(),
    getDripJobsSyncHealth(),
  ]);
  const leads2026 = leads.filter((lead) => lead.createdOn.startsWith("2026-"));
  const meta2026 = leads2026.filter(
    (lead) => lead.normalizedChannel === "paid_social",
  ).length;

  return (
    <>
      <PageHeader
        title="Leads & Estimates"
        subtitle="All Leads is the lead source; DripJobs is the job source. Their relationship is saved with auditable evidence."
      />
      <StatGrid columns={4} className="mb-4 rounded-[var(--radius)] border border-[var(--color-border)]">
        <Stat label="2026 leads" value={leads2026.length.toLocaleString("en-CA")} hint={`${leads.length.toLocaleString("en-CA")} all time`} />
        <Stat label="Meta leads" value={meta2026.toLocaleString("en-CA")} hint={`${((meta2026 / Math.max(leads2026.length, 1)) * 100).toFixed(1)}% of 2026 leads`} />
        <Stat label="Jobs linked to leads" value={jobCoverage.confirmed.toLocaleString("en-CA")} hint={`${jobCoverage.confirmed.toLocaleString("en-CA")} of ${jobCoverage.total.toLocaleString("en-CA")} DripJobs jobs`} />
        <Stat label="Lead source missing" value={jobCoverage.missingSource.toLocaleString("en-CA")} hint={jobCoverage.needsReview ? `${jobCoverage.needsReview} additional job links need review` : "Archived jobs absent from All Leads"} />
      </StatGrid>
      <StatGrid columns={4} className="mb-4 rounded-[var(--radius)] border border-[var(--color-border)]">
        <Stat
          label="Live Zapier leads"
          value={syncHealth.liveLeadEvents.toLocaleString("en-CA")}
          hint="Historical export remains preserved"
        />
        <Stat
          label="Accepted proposals"
          value={syncHealth.acceptedProposalEvents.toLocaleString("en-CA")}
          hint="Received after live cutover"
        />
        <Stat
          label="Duplicate deliveries"
          value={syncHealth.duplicateDeliveries.toLocaleString("en-CA")}
          hint="Safely ignored by event identity"
        />
        <Stat
          label="Sync status"
          value={syncHealth.failedEvents ? "Needs attention" : "Healthy"}
          hint={
            syncHealth.lastProcessedAt
              ? `Last processed ${new Date(syncHealth.lastProcessedAt).toLocaleString("en-CA", { timeZone: "America/Toronto" })}`
              : "Waiting for the first live event"
          }
          tone={syncHealth.failedEvents ? "bad" : "good"}
        />
      </StatGrid>
      <LeadsTable leads={leads} />
    </>
  );
}
