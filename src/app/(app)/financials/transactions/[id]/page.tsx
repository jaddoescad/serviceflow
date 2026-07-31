import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerRevenueTransactionEvidence } from "@/components/customer-revenue-evidence";
import { PaymentEvidence } from "@/components/settlement-evidence";
import { Badge } from "@/components/ui";
import { PageHeader } from "@/components/kpi";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { getCustomerRevenueTransactionEvidence } from "@/lib/customer-revenue";
import { getLabourPaymentEvidence } from "@/lib/settlements";

export const dynamic = "force-dynamic";

export default async function FinancialTransactionEvidencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const transactionId = decodeURIComponent(id);
  const [, payment, customerRevenue] = await Promise.all([
    requireStaff(),
    getLabourPaymentEvidence(transactionId),
    getCustomerRevenueTransactionEvidence(transactionId),
  ]);

  if (!payment) notFound();

  const hasFullyAllocatedBonus =
    payment.verification != null &&
    Number(payment.verification.invoice_allocated_amount) <= 0 &&
    Number(payment.verification.unallocated_amount) <= 0.005 &&
    Number(payment.verification.bonus_allocated_amount) > 0;
  const hasFullyAllocatedOtherSettlement =
    payment.verification != null &&
    Number(payment.verification.invoice_allocated_amount) <= 0 &&
    Number(payment.verification.unallocated_amount) <= 0.005 &&
    Number(payment.verification.other_allocated_amount) > 0;
  const hasMissingSubcontractorInvoice =
    payment.transaction.category === "Subcontractors" &&
    !payment.transaction.is_overpayment &&
    !payment.transaction.has_no_invoice &&
    !payment.transaction.invoice_not_found &&
    !payment.transaction.partial_no_invoice_residual &&
    !hasFullyAllocatedBonus &&
    !hasFullyAllocatedOtherSettlement &&
    Number(payment.verification?.invoice_allocated_amount ?? 0) <= 0;
  const hasBankSupportedExpense =
    payment.transaction.expense_evidence_status === "bank_supported_no_itc" &&
    payment.transaction.review_status === "reconciled";
  const settlementLabel = customerRevenue
    ? customerRevenue.verification.payment_status === "fully_allocated"
      ? "Customer invoice matched"
      : customerRevenue.verification.payment_status === "partially_allocated"
        ? "Partially matched"
        : "Customer invoice missing"
    : payment.transaction.is_overpayment
    ? "Overpayment"
    : payment.transaction.partial_no_invoice_residual
      ? "Partial match · balance has no invoice"
      : payment.transaction.has_no_invoice
        ? "No invoice"
        : payment.transaction.invoice_not_found
          ? "Invoice not found"
          : hasFullyAllocatedBonus
            ? "Bonus paid"
            : hasFullyAllocatedOtherSettlement
              ? "Settled without invoice"
              : hasMissingSubcontractorInvoice
                ? "Invoice missing"
                : hasBankSupportedExpense
                  ? payment.transaction.transaction_type === "credit"
                    ? "Subscription credit reconciled"
                    : "Software expense reconciled"
                  : (payment.verification?.payment_status
                      ?.replace("unidentified", "Recipient not verified")
                      .replaceAll("_", " ")
                      .replace(/^\w/, (character) => character.toUpperCase()) ??
                    "Needs review");

  return (
    <>
      <div className="mb-4">
        <Link
          href="/financials"
          className="text-sm font-medium text-[var(--color-brand-strong)] hover:underline"
        >
          ← Financials
        </Link>
      </div>
      <PageHeader
        title={
          payment.transaction.counterparty ?? payment.transaction.description
        }
        subtitle={`${fmtDate(payment.transaction.posted_on)} · ${
          payment.transaction.account_name
        } •••• ${payment.transaction.account_last_four ?? "—"}`}
        actions={
          <Badge
            tone={
              customerRevenue
                ? customerRevenue.verification.payment_status ===
                  "fully_allocated"
                  ? "good"
                  : customerRevenue.verification.payment_status ===
                      "partially_allocated"
                    ? "warn"
                    : "bad"
                : payment.transaction.is_overpayment
                ? "bad"
                : hasMissingSubcontractorInvoice
                  ? "bad"
                  : hasBankSupportedExpense
                    ? "good"
                    : payment.verification?.payment_status === "fully_allocated"
                      ? "good"
                      : "warn"
            }
          >
            {settlementLabel}
          </Badge>
        }
      />
      {customerRevenue ? (
        <CustomerRevenueTransactionEvidence evidence={customerRevenue} />
      ) : (
        <PaymentEvidence payment={payment} />
      )}
    </>
  );
}
