import { Kpi, PageHeader } from "@/components/kpi";
import { MaterialInvoicesTable } from "@/components/material-invoices-table";
import { requireStaff } from "@/lib/auth";
import {
  getMaterialInvoices,
  getMaterialPortalEvidenceSummary,
} from "@/lib/materials";

export const dynamic = "force-dynamic";

export default async function MaterialInvoicesPage() {
  const [, invoices, portalEvidence] = await Promise.all([
    requireStaff(),
    getMaterialInvoices(),
    getMaterialPortalEvidenceSummary(),
  ]);
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
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
        <Kpi
          label="Portal source gaps"
          value={portalEvidence.sourceMissingRows}
          hint={
            portalEvidence.sourceMissingRows
              ? `${new Intl.NumberFormat("en-CA", {
                  style: "currency",
                  currency: "CAD",
                }).format(portalEvidence.sourceMissingTotal)} listed without a physical PDF`
              : `${portalEvidence.totalRows} portal rows have physical evidence`
          }
          tone={portalEvidence.sourceMissingRows ? "warn" : "good"}
        />
      </div>
      <MaterialInvoicesTable invoices={invoices} />
    </>
  );
}
