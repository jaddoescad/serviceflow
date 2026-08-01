import { Kpi, PageHeader } from "@/components/kpi";
import { MaterialInvoicesTable } from "@/components/material-invoices-table";
import { requireStaff } from "@/lib/auth";
import { getMaterialInvoices } from "@/lib/materials";

export const dynamic = "force-dynamic";

export default async function MaterialInvoicesPage() {
  const [, invoices] = await Promise.all([requireStaff(), getMaterialInvoices()]);
  const settled = invoices.filter(
    (invoice) => Math.abs(invoice.amountRemaining) <= 0.02,
  ).length;
  const allocated = invoices.filter(
    (invoice) =>
      Math.abs(invoice.jobAllocatedTotal - invoice.totalAmount) <= 0.02,
  ).length;
  const needsJob = invoices.length - allocated;
  const sourceDocuments = new Set(
    invoices.map((invoice) => invoice.documentId),
  ).size;

  return (
    <>
      <PageHeader
        title="Material invoices"
        subtitle="Supplier documents, product lines, job costs, credits, and bank-payment evidence"
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Invoices"
          value={invoices.length}
          hint={`${sourceDocuments} archived source documents`}
        />
        <Kpi
          label="Settled"
          value={settled}
          hint={`of ${invoices.length} invoices and credits`}
          tone={settled ? "good" : "neutral"}
        />
        <Kpi
          label="Job / general supplies allocated"
          value={allocated}
          hint="line totals fully classified"
          tone={allocated ? "good" : "neutral"}
        />
        <Kpi
          label="Needs job"
          value={needsJob}
          hint="kept out of job costing until resolved"
          tone={needsJob ? "warn" : "good"}
        />
      </div>
      <MaterialInvoicesTable invoices={invoices} />
    </>
  );
}
