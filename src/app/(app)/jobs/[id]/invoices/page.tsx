import { notFound, redirect } from "next/navigation";
import { Kpi } from "@/components/kpi";
import { JobShell } from "@/components/job-shell";
import { UnifiedInvoicesTable } from "@/components/unified-invoices";
import { getProjectShell } from "@/lib/project-data";
import { fmtMoney } from "@/lib/format";
import { getJobInvoices } from "@/lib/v2-accounting";

export const dynamic = "force-dynamic";

export default async function JobInvoicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = decodeURIComponent(id);
  const shell = await getProjectShell(jobId);
  if (!shell) notFound();
  if (shell.canonicalJobId) {
    redirect(`/jobs/${encodeURIComponent(shell.canonicalJobId)}/invoices`);
  }
  const allocations = await getJobInvoices(jobId);
  const byInvoice = new Map<string, any>();
  for (const allocation of allocations) {
    const invoice: any = Array.isArray(allocation.invoice) ? allocation.invoice[0] : allocation.invoice;
    if (!invoice || invoice.category !== "labour") continue;
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
  return (
    <JobShell
      projectId={jobId}
      name={shell.name}
      address={shell.address}
      status={shell.status}
      photoCount={shell.photoCount}
      isLead={shell.isLead}
      activeTab="invoices"
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Kpi label="Invoices" value={invoices.length} />
        <Kpi label="Labour cost" value={fmtMoney(labour)} />
      </div>
      <UnifiedInvoicesTable
        invoices={invoices}
        title="Labour invoices"
        showJobAllocation
      />
    </JobShell>
  );
}
