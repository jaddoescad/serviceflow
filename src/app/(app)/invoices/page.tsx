import { requireStaff } from "@/lib/auth";
import { getInvoiceEntries } from "@/lib/invoice-entry-queries";
import { PageHeader, Kpi } from "@/components/kpi";
import { InvoiceDocumentsTable } from "@/components/invoice-documents-table";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const [, entries] = await Promise.all([requireStaff(), getInvoiceEntries()]);
  const sourceInvoices = new Set(entries.map((entry) => entry.invoice_id)).size;
  const linkedEntries = entries.filter((entry) => entry.jobs.length > 0).length;
  const overheadEntries = entries.filter(
    (entry) =>
      entry.jobs.length === 0 &&
      entry.invoice.match_status === "overhead_unmatched",
  ).length;
  const needsJobReview = entries.filter(
    (entry) =>
      entry.jobs.length === 0 &&
      entry.invoice.match_status !== "overhead_unmatched",
  ).length;

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Browse complete invoices and expand any row to inspect its individual items"
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Invoices"
          value={sourceInvoices}
          hint={`${entries.length} individual items`}
        />
        <Kpi
          label="Job-linked items"
          value={linkedEntries}
          hint={`of ${entries.length} invoice items`}
          tone={linkedEntries ? "good" : "neutral"}
        />
        <Kpi
          label="Overhead / no job"
          value={overheadEntries}
          hint="explicitly classified outside job cost"
        />
        <Kpi
          label="Needs job link"
          value={needsJobReview}
          hint="not counted in any job yet"
          tone={needsJobReview ? "warn" : "good"}
        />
      </div>
      <InvoiceDocumentsTable entries={entries} />
    </>
  );
}
