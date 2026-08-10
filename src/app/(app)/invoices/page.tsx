import { PageHeader } from "@/components/kpi";
import { LabourInvoiceReview } from "@/components/labour-invoice-review";
import { requireStaff } from "@/lib/auth";
import { getLabourInvoiceReviewInvoices } from "@/lib/v2-accounting";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  await requireStaff();
  const invoices = await getLabourInvoiceReviewInvoices();
  return (
    <>
      <PageHeader
        title="Labour invoices"
        subtitle="Payment readiness review for painter and subcontractor invoices"
      />
      <LabourInvoiceReview invoices={invoices} />
    </>
  );
}
