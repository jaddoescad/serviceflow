import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Kpi } from "@/components/kpi";
import { ProjectTabs } from "@/components/project-tabs";
import { InvoiceEntriesTable } from "@/components/invoice-entries-table";
import { Badge } from "@/components/ui";
import { getProjectShell } from "@/lib/project-data";
import { getInvoiceEntriesForProject } from "@/lib/invoice-entry-queries";
import {
  getProjectLabourInvoiceSummary,
  isInvoiceInCurrentJob,
} from "@/lib/invoice-queries";
import { fmtCurrencyTotals } from "@/lib/format";

export const dynamic = "force-dynamic";

function addCurrencyTotals(
  left: Record<"CAD" | "USD", number>,
  right: Record<"CAD" | "USD", number>,
) {
  return {
    CAD: left.CAD + right.CAD,
    USD: left.USD + right.USD,
  };
}

export default async function ProjectInvoicesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const projectId = decodeURIComponent(id);
  const [shell, entries, summary] = await Promise.all([
    getProjectShell(projectId),
    getInvoiceEntriesForProject(projectId),
    getProjectLabourInvoiceSummary(projectId),
  ]);

  if (!shell) notFound();

  const currentEntries = entries.filter((entry) =>
    isInvoiceInCurrentJob(entry.invoice, summary.jobStartedOn),
  );
  const historicalEntries = entries.filter(
    (entry) => !isInvoiceInCurrentJob(entry.invoice, summary.jobStartedOn),
  );
  const notFullySettledTotals = addCurrencyTotals(
    summary.confirmedUnpaidTotals,
    summary.partialSettlementTotals,
  );
  const partialSettlementAmount = fmtCurrencyTotals(
    summary.partialSettlementTotals,
  );

  return (
    <>
      <div className="mb-2 text-xs text-[var(--color-muted)]">
        <Link href="/projects" className="hover:text-[var(--color-text)]">
          Jobs &amp; Budgets
        </Link>
        <span className="mx-1.5">/</span>
        <Link
          href={`/projects/${encodeURIComponent(projectId)}`}
          className="hover:text-[var(--color-text)]"
        >
          {shell.name}
        </Link>
        <span className="mx-1.5">/</span>
        <span>Invoices</span>
      </div>

      <PageHeader title={shell.name} subtitle={shell.address ?? undefined} />
      <ProjectTabs projectId={projectId} projectName={shell.name} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Invoiced job cost"
          value={fmtCurrencyTotals(summary.totals)}
          hint="all allocated entries · before HST"
        />
        <Kpi
          label="Confirmed paid"
          value={fmtCurrencyTotals(summary.confirmedPaidTotals)}
          hint="entries on fully paid invoices"
          tone="good"
        />
        <Kpi
          label="Not fully settled"
          value={fmtCurrencyTotals(notFullySettledTotals)}
          hint={
            summary.partialSettlementTotals.CAD !== 0 ||
            summary.partialSettlementTotals.USD !== 0
              ? `${partialSettlementAmount} is on partially paid invoices`
              : "entries on unpaid invoices"
          }
          tone={
            notFullySettledTotals.CAD !== 0 ||
            notFullySettledTotals.USD !== 0
              ? "warn"
              : "neutral"
          }
        />
        <Kpi
          label="Evidence chain"
          value={`${summary.invoiceCount} ${
            summary.invoiceCount === 1 ? "invoice" : "invoices"
          }`}
          hint={`${summary.entryCount} entries · ${summary.paymentEvidenceCount} bank payments`}
        />
      </div>

      {summary.needsReview ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[var(--color-warn)]">
          <Badge tone="warn">Review</Badge>
          At least one invoice entry, job allocation, or invoice settlement
          needs review.
        </div>
      ) : null}

      <InvoiceEntriesTable
        entries={currentEntries}
        initialType="all"
        title="Current job invoice entries"
        subtitle="The job cost comes from these entry allocations; payment and bank evidence stays attached to the parent invoice"
        showJobs={false}
        projectId={projectId}
      />

      {historicalEntries.length > 0 ? (
        <div className="mt-6">
          <InvoiceEntriesTable
            entries={historicalEntries}
            initialType="all"
            title="Previous job invoice entries"
            subtitle="Linked to the same customer project, but excluded from the current job budget and labour totals"
            showJobs={false}
            projectId={projectId}
          />
        </div>
      ) : null}
    </>
  );
}
