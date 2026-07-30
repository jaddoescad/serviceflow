import { requireStaff } from "@/lib/auth";
import { getInvoiceEntries } from "@/lib/invoice-entry-queries";
import { PageHeader, Kpi } from "@/components/kpi";
import { InvoiceEntriesTable } from "@/components/invoice-entries-table";

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
        subtitle="Browse individual entries while preserving every original invoice as source evidence"
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Invoice entries"
          value={entries.length}
          hint={`across ${sourceInvoices} source invoices`}
        />
        <Kpi
          label="Exact source entries"
          value={exactEntries}
          hint="transcribed from the invoice"
          tone={exactEntries ? "good" : "neutral"}
        />
        <Kpi
          label="Derived job entries"
          value={derivedEntries}
          hint="preserved legacy job-dollar matches"
          tone={derivedEntries ? "warn" : "neutral"}
        />
        <Kpi
          label="Needs exact extraction"
          value={needsExtraction}
          hint="visible placeholders, never hidden"
          tone={needsExtraction ? "warn" : "good"}
        />
      </div>
      <InvoiceEntriesTable entries={entries} />
    </>
  );
}
