import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerRevenueTransactionEvidence } from "@/components/customer-revenue-evidence";
import { PaymentEvidence } from "@/components/settlement-evidence";
import { StatusText } from "@/components/ui";
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
  const customerRevenueException = payment.transaction
    .customer_revenue_exception_kind
    ? {
        kind: payment.transaction.customer_revenue_exception_kind,
        detail: payment.transaction.customer_revenue_exception_detail,
        needsReview:
          payment.transaction.customer_revenue_exception_needs_review,
      }
    : null;
  const customerRevenueExceptionLabel =
    customerRevenueException?.kind === "refunded_deposit"
      ? "Deposit refunded"
      : customerRevenueException?.kind === "paired_refund"
        ? "Matched after refund"
        : customerRevenueException?.kind === "overpayment" ||
            customerRevenueException?.kind === "rounding_overpayment"
          ? "Customer overpayment"
          : customerRevenueException?.kind ===
              "processor_invoice_composition_missing"
            ? "Processor batch needs invoices"
            : customerRevenueException
              ? "Customer identified · invoice missing"
              : null;
  const settlementLabel = customerRevenue
    ? customerRevenueExceptionLabel ??
      (customerRevenue.verification.payment_status === "fully_allocated"
      ? "Customer invoice matched"
      : customerRevenue.verification.payment_status === "partially_allocated"
        ? "Partially matched"
        : "Customer invoice missing")
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

  const money = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: payment.transaction.currency || "CAD",
  });
  const statusTone = customerRevenue
    ? customerRevenueException
      ? customerRevenueException.needsReview
        ? ("warn" as const)
        : ("good" as const)
      : customerRevenue.verification.payment_status === "fully_allocated"
      ? ("good" as const)
      : customerRevenue.verification.payment_status === "partially_allocated"
        ? ("warn" as const)
        : ("bad" as const)
    : payment.transaction.is_overpayment
      ? ("bad" as const)
      : hasMissingSubcontractorInvoice
        ? ("bad" as const)
        : hasBankSupportedExpense
          ? ("good" as const)
          : payment.verification?.payment_status === "fully_allocated"
            ? ("good" as const)
            : ("warn" as const);

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
          {statusTone !== "good" ? (
            <span className="ml-auto">
              <StatusText tone={statusTone}>{settlementLabel}</StatusText>
            </span>
          ) : null}
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
