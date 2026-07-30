import { InvoiceBankMatchTable } from "@/components/invoice-bank-match-table";
import { Kpi, PageHeader } from "@/components/kpi";
import { Badge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getInvoiceBankMatchReport } from "@/lib/invoice-bank-matching";

export const dynamic = "force-dynamic";

export default async function InvoicePaymentsPage() {
  const [, report] = await Promise.all([
    requireStaff(),
    getInvoiceBankMatchReport(),
  ]);

  return (
    <>
      <PageHeader
        title="Invoice payments"
        subtitle="Read-only invoice ↔ bank matching based on gross amounts and recipient evidence"
        actions={<Badge tone="brand">Suggestions only</Badge>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Ready to confirm"
          value={report.stats.readyToConfirm}
          hint="exact amount + confirmed recipient"
          tone={report.stats.readyToConfirm ? "good" : "neutral"}
        />
        <Kpi
          label="Combined / split"
          value={report.stats.combinedOrSplit}
          hint="requires allocation review"
          tone={report.stats.combinedOrSplit ? "warn" : "neutral"}
        />
        <Kpi
          label="Recipient confirmation"
          value={report.stats.recipientConfirmation}
          hint="amount matches, identity does not"
          tone={report.stats.recipientConfirmation ? "warn" : "neutral"}
        />
        <Kpi
          label="No candidate"
          value={report.stats.unmatchedInvoices + report.stats.unmatchedPayments}
          hint={`${report.stats.unmatchedInvoices} invoices · ${report.stats.unmatchedPayments} bank entries`}
          tone={
            report.stats.unmatchedInvoices + report.stats.unmatchedPayments
              ? "bad"
              : "good"
          }
        />
      </div>
      <InvoiceBankMatchTable report={report} />
    </>
  );
}
