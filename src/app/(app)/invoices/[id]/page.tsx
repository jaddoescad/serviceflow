import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceEvidence } from "@/components/settlement-evidence";
import { Badge } from "@/components/ui";
import { PageHeader } from "@/components/kpi";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { getLabourInvoiceEvidence } from "@/lib/settlements";

export const dynamic = "force-dynamic";

export default async function LabourInvoiceEvidencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoiceId = decodeURIComponent(id);
  const [, invoice] = await Promise.all([
    requireStaff(),
    getLabourInvoiceEvidence(invoiceId),
  ]);

  if (!invoice) notFound();

  return (
    <>
      <div className="mb-4">
        <Link
          href="/invoices"
          className="text-sm font-medium text-[var(--color-brand-strong)] hover:underline"
        >
          ← Labour invoices
        </Link>
      </div>
      <PageHeader
        title={`${invoice.verification.supplier_name} · Invoice #${invoice.verification.invoice_number}`}
        subtitle={`${fmtDate(invoice.verification.invoice_date)} · ${
          invoice.verification.original_filename
        }`}
        actions={
          <div className="flex items-center gap-2">
            <Badge
              tone={
                invoice.verification.payment_status === "paid"
                  ? "good"
                  : "warn"
              }
            >
              {invoice.verification.payment_status.replaceAll("_", " ")}
            </Badge>
            <Badge
              tone={
                invoice.verification.verification_status === "verified"
                  ? "good"
                  : "warn"
              }
            >
              {invoice.verification.verification_status.replaceAll("_", " ")}
            </Badge>
          </div>
        }
      />
      <InvoiceEvidence invoice={invoice} />
    </>
  );
}
