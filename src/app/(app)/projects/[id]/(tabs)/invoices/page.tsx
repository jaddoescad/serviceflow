import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Kpi } from "@/components/kpi";
import { ProjectTabs } from "@/components/project-tabs";
import { LabourInvoicesTable } from "@/components/labour-invoices-table";
import { Badge } from "@/components/ui";
import { getProjectShell } from "@/lib/project-data";
import {
  getLabourInvoicesForProject,
  getProjectLabourInvoiceSummary,
  isInvoiceInCurrentJob,
} from "@/lib/invoice-queries";
import { fmtCurrencyTotals } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProjectInvoicesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const projectId = decodeURIComponent(id);
  const [shell, invoices, summary] = await Promise.all([
    getProjectShell(projectId),
    getLabourInvoicesForProject(projectId),
    getProjectLabourInvoiceSummary(projectId),
  ]);

  if (!shell) notFound();

  const currentInvoices = invoices.filter((invoice) =>
    isInvoiceInCurrentJob(invoice, summary.jobStartedOn),
  );
  const historicalInvoices = invoices.filter(
    (invoice) =>
      !isInvoiceInCurrentJob(invoice, summary.jobStartedOn),
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

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi
          label="Labour invoices"
          value={
            summary.hasUnallocatedSharedInvoices &&
            summary.totals.CAD === 0 &&
            summary.totals.USD === 0
              ? "Needs allocation"
              : fmtCurrencyTotals(summary.totals)
          }
          hint="pre-tax amount"
          tone={summary.hasUnallocatedSharedInvoices ? "warn" : "neutral"}
        />
        <Kpi
          label="Invoices"
          value={summary.invoiceCount}
          hint="latest version counted"
        />
        <Kpi
          label="Linked files"
          value={summary.linkedFileCount}
          hint={
            summary.historicalLinkedFileCount > 0
              ? `${summary.historicalLinkedFileCount} previous-job files excluded`
              : summary.hasDuplicateVersions
              ? "includes duplicate/revised files"
              : "source invoice files"
          }
        />
      </div>

      {summary.hasUnallocatedSharedInvoices || summary.needsReview ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[var(--color-warn)]">
          <Badge tone="warn">Review</Badge>
          {summary.hasUnallocatedSharedInvoices
            ? `${summary.unallocatedSharedInvoiceCount} shared ${
                summary.unallocatedSharedInvoiceCount === 1
                  ? "invoice is"
                  : "invoices are"
              } excluded from the total until the pre-tax amount is allocated to this job.`
            : "At least one invoice-to-job association is marked for review."}
        </div>
      ) : null}

      <LabourInvoicesTable
        invoices={currentInvoices}
        title="Current job labour invoices"
        subtitle="These files feed the current job total; revised versions are counted once"
        showAssociatedJobs={false}
      />

      {historicalInvoices.length > 0 ? (
        <div className="mt-6">
          <LabourInvoicesTable
            invoices={historicalInvoices}
            title="Previous job invoice files"
            subtitle="Linked to the same customer project, but excluded from the current job budget and labour totals"
            showAssociatedJobs={false}
          />
        </div>
      ) : null}
    </>
  );
}
