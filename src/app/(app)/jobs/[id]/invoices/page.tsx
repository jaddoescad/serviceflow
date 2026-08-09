import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Kpi } from "@/components/kpi";
import { ProjectTabs } from "@/components/project-tabs";
import { UnifiedInvoicesTable } from "@/components/unified-invoices";
import { getProjectShell } from "@/lib/project-data";
import { fmtMoney } from "@/lib/format";
import { getJobInvoices } from "@/lib/v2-accounting";

export const dynamic = "force-dynamic";

export default async function JobInvoicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = decodeURIComponent(id);
  const [shell, allocations] = await Promise.all([getProjectShell(jobId), getJobInvoices(jobId)]);
  if (!shell) notFound();
  const byInvoice = new Map<string, any>();
  for (const allocation of allocations) {
    const invoice: any = Array.isArray(allocation.invoice) ? allocation.invoice[0] : allocation.invoice;
    if (!invoice) continue;
    const existing = byInvoice.get(invoice.id);
    if (existing) {
      existing.allocations.push({ ...allocation, job: { name: shell.name } });
    } else {
      byInvoice.set(invoice.id, {
        ...invoice,
        allocations: [{ ...allocation, job: { name: shell.name } }],
      });
    }
  }
  const invoices = [...byInvoice.values()].sort((left, right) =>
    String(right.issued_on ?? "").localeCompare(String(left.issued_on ?? "")),
  );
  const labour = allocations.filter((row: any) => {
    const invoice = Array.isArray(row.invoice) ? row.invoice[0] : row.invoice;
    return invoice?.category === "labour";
  }).reduce((sum, row) => sum + Number(row.subtotal_cents ?? 0), 0) / 100;
  const materials = allocations.filter((row: any) => {
    const invoice = Array.isArray(row.invoice) ? row.invoice[0] : row.invoice;
    return invoice?.category === "material";
  }).reduce((sum, row) => sum + Number(row.subtotal_cents ?? 0), 0) / 100;
  return (
    <>
      <div className="mb-2 text-xs text-[var(--color-muted)]">
        <Link href="/jobs" className="hover:text-[var(--color-text)]">Jobs & Budgets</Link>
        <span className="mx-1.5">/</span>
        <Link href={`/jobs/${jobId}`} className="hover:text-[var(--color-text)]">{shell.name}</Link>
        <span className="mx-1.5">/</span><span>Invoices</span>
      </div>
      <PageHeader title={shell.name} subtitle={shell.address ?? undefined} />
      <ProjectTabs projectId={jobId} projectName={shell.name} entityKind="job" />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Invoices" value={invoices.length} />
        <Kpi label="Labour cost" value={fmtMoney(labour)} />
        <Kpi label="Material cost" value={fmtMoney(materials)} />
      </div>
      <UnifiedInvoicesTable
        invoices={invoices}
        title="Job invoices and costs"
        showJobAllocation
      />
    </>
  );
}
