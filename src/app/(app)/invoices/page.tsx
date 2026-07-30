import { requireStaff } from "@/lib/auth";
import { getInvoiceEntries } from "@/lib/invoice-entry-queries";
import { PageHeader, Kpi } from "@/components/kpi";
import { InvoiceDocumentsTable } from "@/components/invoice-documents-table";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const [, entries] = await Promise.all([requireStaff(), getInvoiceEntries()]);
  const sourceInvoices = new Set(entries.map((entry) => entry.invoice_id)).size;
  const exactEntries = entries.filter(
    (entry) => entry.source_kind === "extracted",
  ).length;
  const derivedEntries = entries.filter(
    (entry) => entry.source_kind === "legacy_project_link",
  ).length;
  const needsExtraction = entries.filter(
    (entry) => entry.source_kind === "legacy_invoice_total",
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
          label="Exact invoice items"
          value={exactEntries}
          hint="transcribed from the invoice"
          tone={exactEntries ? "good" : "neutral"}
        />
        <Kpi
          label="Derived job items"
          value={derivedEntries}
          hint="preserved legacy job-dollar matches"
          tone={derivedEntries ? "warn" : "neutral"}
        />
        <Kpi
          label="Needs item extraction"
          value={needsExtraction}
          hint="visible placeholders, never hidden"
          tone={needsExtraction ? "warn" : "good"}
        />
      </div>
      <InvoiceDocumentsTable entries={entries} />
    </>
  );
}
