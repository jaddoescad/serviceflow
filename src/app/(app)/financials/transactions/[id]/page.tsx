import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerRevenueTransactionEvidence } from "@/components/customer-revenue-evidence";
import { PaymentEvidence } from "@/components/settlement-evidence";
import { StatusText } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { getCustomerRevenueTransactionEvidence } from "@/lib/customer-revenue";
import { resolveSettlementStatus } from "@/lib/financial-settlement-status";
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

  const customerRevenueException = payment.transaction
    .customer_revenue_exception_kind
    ? {
        kind: payment.transaction.customer_revenue_exception_kind,
        detail: payment.transaction.customer_revenue_exception_detail,
        needsReview:
          payment.transaction.customer_revenue_exception_needs_review,
      }
    : null;
  const settlement = resolveSettlementStatus({
    transferCancelled: payment.transaction.transfer_cancelled,
    customerExceptionKind:
      payment.transaction.customer_revenue_exception_kind,
    customerExceptionNeedsReview:
      payment.transaction.customer_revenue_exception_needs_review,
    customerRevenueStatus:
      customerRevenue?.verification.payment_status ?? null,
    overpaymentConfirmed: payment.transaction.is_overpayment,
    invoiceEvidenceStatus: payment.transaction.has_no_invoice
      ? "no_invoice_provided"
      : payment.transaction.invoice_not_found
        ? "invoice_not_found"
        : payment.transaction.partial_no_invoice_residual
          ? "partial_no_invoice_residual"
          : null,
    expenseEvidenceConfirmed:
      payment.transaction.expense_evidence_status === "bank_supported_no_itc",
    expenseEvidenceLabel:
      payment.transaction.expense_evidence_status === "bank_supported_no_itc"
        ? payment.transaction.expense_evidence_label ??
          (payment.transaction.transaction_type === "credit"
            ? "Subscription credit"
            : "Documented expense")
        : null,
    documentExceptionLabel: payment.transaction.document_exception_label,
    noDocumentRequired: payment.transaction.category === "Bank fees",
    paymentStatus: payment.verification?.payment_status ?? null,
    invoiceAllocatedAmount: payment.verification?.invoice_allocated_amount,
    bonusAllocatedAmount: payment.verification?.bonus_allocated_amount,
    otherAllocatedAmount: payment.verification?.other_allocated_amount,
  });
  const settlementLabel = settlement.label;

  const money = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: payment.transaction.currency || "CAD",
  });
  const statusTone = settlement.tone;

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
      <div className="mb-5">
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <span className="font-display text-3xl font-bold tracking-tight tabular-nums text-[var(--color-heading)]">
            {money.format(Math.abs(payment.transaction.amount))}
          </span>
          <span className="text-base font-semibold text-[var(--color-heading)]">
            {payment.transaction.transaction_type === "income" ? "←" : "→"}{" "}
            {payment.transaction.counterparty ??
              payment.transaction.description}
            {payment.contractor?.worker_name ? (
              <span className="font-normal text-[var(--color-muted)]">
                {" "}
                · {payment.contractor.worker_name}
              </span>
            ) : null}
          </span>
          <span className="ml-auto">
            <StatusText tone={statusTone}>{settlementLabel}</StatusText>
          </span>
        </div>
        <p className="mt-1 text-[13px] text-[var(--color-muted)]">
          {fmtDate(payment.transaction.posted_on)} ·{" "}
          {payment.transaction.account_name} ••••{" "}
          {payment.transaction.account_last_four ?? "—"}
        </p>
      </div>
      {customerRevenue ? (
        <CustomerRevenueTransactionEvidence
          evidence={customerRevenue}
          receivedFrom={payment.transaction.counterparty}
          exception={customerRevenueException}
        />
      ) : (
        <PaymentEvidence payment={payment} />
      )}
    </>
  );
}
