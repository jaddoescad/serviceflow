import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { JobShell } from "@/components/job-shell";
import { InvoiceRows } from "@/components/invoice-rows";
import { TablePanel } from "@/components/table-ui";
import { EmptyState, buttonClassName } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getInvoices } from "@/lib/billing";
import { getProjectShell } from "@/lib/project-data";

export const dynamic = "force-dynamic";

export default async function JobInvoicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = decodeURIComponent(id);
  const [shell, invoices] = await Promise.all([getProjectShell(jobId), getInvoices(jobId), requireStaff()]);
  if (!shell) notFound();
  if (shell.canonicalJobId) redirect(`/jobs/${encodeURIComponent(shell.canonicalJobId)}/invoices`);
  if (shell.isLead) redirect(`/jobs/${encodeURIComponent(jobId)}/proposals`);
  const base = `/jobs/${encodeURIComponent(jobId)}/invoices`;
  return (
    <JobShell
      projectId={jobId}
      name={shell.name}
      address={shell.address}
      status={shell.status}
      photoCount={shell.photoCount}
      isLead={false}
      activeTab="invoices"
      actions={
        <>
          <Link href={`${base}/new`} className={buttonClassName({ variant: "secondary" })}>
            + New Invoice
          </Link>
          <Link href={`${base}/new?kind=final`} className={buttonClassName()}>
            + Final Invoice
          </Link>
        </>
      }
    >
      <TablePanel>
        <InvoiceRows invoices={invoices} showCustomer={false} />
        {invoices.length ? null : <EmptyState>No invoices yet.</EmptyState>}
      </TablePanel>
    </JobShell>
  );
}
