"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";
import { Badge, Card, CardHeader } from "@/components/ui";
import type { FinancialTransaction } from "@/lib/financials";

const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value: number) {
  const formatted = money.format(Math.abs(value));
  if (value < 0) return `(${formatted})`;
  if (value > 0) return `+${formatted}`;
  return formatted;
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function transactionTone(
  transaction: FinancialTransaction,
): "neutral" | "good" | "warn" | "brand" {
  if (transaction.source_details.transfer_status === "cancelled") {
    return "neutral";
  }
  if (transaction.is_transfer) return "neutral";
  if (transaction.transaction_type === "income") return "good";
  if (transaction.transaction_type === "credit") return "brand";
  return "warn";
}

function transactionLabel(transaction: FinancialTransaction) {
  if (transaction.source_details.transfer_status === "cancelled") {
    return "Cancelled";
  }
  if (transaction.is_transfer) return "Transfer";
  if (transaction.transaction_type === "income") return "Income";
  if (transaction.transaction_type === "credit") return "Credit";
  return "Expense";
}

function nonInvoiceSettlementLabel(transaction: FinancialTransaction) {
  const verification = transaction.payment_verification;
  if (
    verification == null ||
    Number(verification.invoice_allocated_amount) > 0 ||
    Number(verification.unallocated_amount) > 0.005
  ) {
    return null;
  }
  if (Number(verification.bonus_allocated_amount) > 0) {
    return "Bonus paid";
  }
  if (Number(verification.other_allocated_amount) > 0) {
    return "Settled without invoice";
  }
  return null;
}

function reviewLabel(transaction: FinancialTransaction) {
  if (transaction.source_details.transfer_status === "cancelled") {
    return "Cancelled";
  }
  const customerException =
    transaction.source_details.customer_revenue_exception_kind;
  if (customerException === "refunded_deposit") return "Deposit refunded";
  if (customerException === "paired_refund") return "Matched after refund";
  if (
    customerException === "overpayment" ||
    customerException === "rounding_overpayment"
  ) {
    return "Customer overpayment";
  }
  if (customerException === "processor_invoice_composition_missing") {
    return "Processor batch needs invoices";
  }
  if (
    customerException === "invoice_missing" ||
    customerException === "legacy_invoice_not_imported"
  ) {
    return "Customer identified · invoice missing";
  }
  const customerRevenue = transaction.customer_revenue_verification;
  if (customerRevenue?.payment_status === "fully_allocated") {
    return "Customer invoice matched";
  }
  if (customerRevenue?.payment_status === "partially_allocated") {
    return "Partially matched";
  }
  if (customerRevenue?.payment_status === "unmatched") {
    return "Customer invoice missing";
  }
  if (transaction.source_details.overpayment_status === "confirmed") {
    return "Overpayment";
  }
  if (
    transaction.source_details.invoice_evidence_status === "no_invoice_provided"
  ) {
    return "No invoice";
  }
  if (
    transaction.source_details.invoice_evidence_status === "invoice_not_found"
  ) {
    return "Invoice not found";
  }
  if (
    transaction.source_details.invoice_evidence_status ===
    "partial_no_invoice_residual"
  ) {
    return "Partial match · balance has no invoice";
  }
  const nonInvoiceLabel = nonInvoiceSettlementLabel(transaction);
  if (nonInvoiceLabel) return nonInvoiceLabel;
  if (
    transaction.category === "Subcontractors" &&
    Number(
      transaction.payment_verification?.invoice_allocated_amount ?? 0,
    ) <= 0
  ) {
    return "Invoice missing";
  }
  const status = transaction.payment_verification?.payment_status;
  if (status === "fully_allocated") return "Fully matched";
  if (status === "partially_allocated") return "Partially matched";
  if (status === "unidentified") return "Recipient not verified";
  if (status === "unmatched") return "Payment unmatched";
  if (status === "needs_review") return "Allocation error";
  if (transaction.review_status === "reconciled") return "Reconciled";
  return "Needs review";
}

function reviewTone(
  transaction: FinancialTransaction,
): "good" | "warn" | "bad" | "neutral" {
  if (transaction.source_details.transfer_status === "cancelled") {
    return "neutral";
  }
  const customerException =
    transaction.source_details.customer_revenue_exception_kind;
  if (
    customerException &&
    !transaction.source_details.customer_revenue_exception_needs_review
  ) {
    return "good";
  }
  if (customerException) return "warn";
  const customerRevenue = transaction.customer_revenue_verification;
  if (customerRevenue?.payment_status === "fully_allocated") return "good";
  if (customerRevenue?.payment_status === "partially_allocated") return "warn";
  if (customerRevenue?.payment_status === "unmatched") return "bad";
  if (transaction.source_details.overpayment_status === "confirmed") {
    return "bad";
  }
  if (
    transaction.source_details.invoice_evidence_status ===
      "no_invoice_provided" ||
    transaction.source_details.invoice_evidence_status ===
      "invoice_not_found" ||
    transaction.source_details.invoice_evidence_status ===
      "partial_no_invoice_residual"
  ) {
    return "warn";
  }
  if (nonInvoiceSettlementLabel(transaction)) return "neutral";
  if (
    transaction.category === "Subcontractors" &&
    Number(
      transaction.payment_verification?.invoice_allocated_amount ?? 0,
    ) <= 0
  ) {
    return "bad";
  }
  const status = transaction.payment_verification?.payment_status;
  if (status === "fully_allocated") return "good";
  if (status === "needs_review") return "bad";
  if (status) return "warn";
  if (transaction.review_status === "reconciled") return "good";
  return transaction.review_status === "needs_review" ? "warn" : "neutral";
}

export function FinancialTransactionsTable({
  transactions,
  totalForPeriod,
}: {
  transactions: FinancialTransaction[];
  totalForPeriod: number;
}) {
  const router = useRouter();

  function openTransaction(transaction: FinancialTransaction) {
    router.push(
      `/financials/transactions/${encodeURIComponent(transaction.id)}`,
    );
  }

  function openFromKeyboard(
    event: KeyboardEvent<HTMLTableRowElement>,
    transaction: FinancialTransaction,
  ) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openTransaction(transaction);
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Consolidated ledger"
        subtitle="Select a transaction to open its bank source, allocations, invoices, jobs, hours, and bonuses"
        right={
          <Badge tone="neutral">
            {transactions.length}
            {transactions.length !== totalForPeriod
              ? ` of ${totalForPeriod}`
              : ""}{" "}
            transactions
          </Badge>
        }
      />
      <div className="overflow-x-auto">
        <table className="min-w-[1320px] w-full text-left text-sm">
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-xs uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">
                Counterparty / description
              </th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 text-right font-medium">Before HST</th>
              <th className="px-4 py-3 text-right font-medium">HST</th>
              <th className="px-4 py-3 text-right font-medium">Gross</th>
              <th className="px-4 py-3 font-medium">Settlement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {transactions.map((transaction) => (
              <tr
                key={transaction.id}
                role="link"
                tabIndex={0}
                aria-label={`Open ${transaction.description} transaction evidence`}
                onClick={() => openTransaction(transaction)}
                onKeyDown={(event) => openFromKeyboard(event, transaction)}
                className="cursor-pointer align-top transition-colors hover:bg-[var(--color-surface-2)] focus:bg-[var(--color-brand-soft)] focus:outline-none"
              >
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[var(--color-muted)]">
                  {formatDate(transaction.posted_on)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="font-medium text-[var(--color-heading)]">
                    {transaction.financial_accounts.name}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                    •••• {transaction.financial_accounts.last_four ?? "—"}
                  </div>
                </td>
                <td className="max-w-[320px] px-4 py-3">
                  <div className="font-medium text-[var(--color-heading)]">
                    {transaction.counterparty ?? transaction.description}
                  </div>
                  <div
                    className="mt-0.5 truncate text-xs text-[var(--color-muted)]"
                    title={transaction.description}
                  >
                    {transaction.description}
                  </div>
                </td>
                <td className="px-4 py-3">{transaction.category}</td>
                <td className="px-4 py-3">
                  <Badge tone={transactionTone(transaction)}>
                    {transactionLabel(transaction)}
                  </Badge>
                </td>
                <td
                  className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${
                    transaction.net_amount < 0
                      ? "text-[var(--color-bad)]"
                      : transaction.net_amount > 0
                        ? "text-[var(--color-good)]"
                        : ""
                  }`}
                >
                  {formatMoney(transaction.net_amount)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--color-muted)]">
                  {formatMoney(transaction.tax_amount)}
                </td>
                <td
                  className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${
                    transaction.amount < 0
                      ? "text-[var(--color-bad)]"
                      : transaction.amount > 0
                        ? "text-[var(--color-good)]"
                        : ""
                  }`}
                >
                  {formatMoney(transaction.amount)}
                </td>
                <td className="max-w-[250px] px-4 py-3">
                  <Badge tone={reviewTone(transaction)}>
                    {reviewLabel(transaction)}
                  </Badge>
                  <div
                    className="mt-1 truncate text-xs text-[var(--color-muted)]"
                    title={transaction.financial_imports.original_filename}
                  >
                    {transaction.financial_imports.original_filename}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!transactions.length ? (
        <div className="px-5 py-10 text-center text-sm text-[var(--color-muted)]">
          No transactions match these filters.
        </div>
      ) : null}
    </Card>
  );
}
