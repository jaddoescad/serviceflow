"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
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
): "neutral" | "good" | "warn" | "bad" | "brand" {
  if (transaction.is_transfer) return "neutral";
  if (transaction.transaction_type === "income") return "good";
  if (transaction.transaction_type === "credit") return "brand";
  return "warn";
}

function transactionLabel(transaction: FinancialTransaction) {
  if (transaction.is_transfer) return "Transfer";
  if (transaction.transaction_type === "income") return "Income";
  if (transaction.transaction_type === "credit") return "Credit";
  return "Expense";
}

function reviewLabel(transaction: FinancialTransaction) {
  if (transaction.evidence.some((item) => item.kind === "labour_invoice")) {
    return "Paid";
  }
  if (transaction.review_status === "reconciled") return "Reconciled";
  return "Needs review";
}

function reviewTone(
  transaction: FinancialTransaction,
): "good" | "warn" | "neutral" {
  if (
    transaction.review_status === "reconciled" ||
    transaction.evidence.some((item) => item.kind === "labour_invoice")
  ) {
    return "good";
  }
  return transaction.review_status === "needs_review" ? "warn" : "neutral";
}

function sourceKindLabel(value: string) {
  return {
    bank_feed: "Live bank feed",
    bank_csv: "Bank CSV",
    credit_card_csv: "Credit-card CSV",
    credit_card_statement: "Credit-card statement",
    etransfer_report: "E-transfer report",
    reconciliation_workbook: "Reconciliation workbook",
    tax_workbook: "Tax workbook",
    accounting_report: "Accounting report",
  }[value] ?? value.replaceAll("_", " ");
}

export function FinancialTransactionsTable({
  transactions,
  totalForPeriod,
}: {
  transactions: FinancialTransaction[];
  totalForPeriod: number;
}) {
  const [selected, setSelected] = useState<FinancialTransaction | null>(null);

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  function openFromKeyboard(
    event: KeyboardEvent<HTMLTableRowElement>,
    transaction: FinancialTransaction,
  ) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setSelected(transaction);
  }

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader
          title="Consolidated ledger"
          subtitle="Select any transaction to see its payment, document, and bank-source associations"
          right={
            <Badge tone="neutral">
              {transactions.length}
              {transactions.length !== totalForPeriod ? ` of ${totalForPeriod}` : ""} transactions
            </Badge>
          }
        />
        <div className="overflow-x-auto">
          <table className="min-w-[1320px] w-full text-left text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-xs uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium">Counterparty / description</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Before HST</th>
                <th className="px-4 py-3 text-right font-medium">HST</th>
                <th className="px-4 py-3 text-right font-medium">Gross</th>
                <th className="px-4 py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {transactions.map((transaction) => (
                <tr
                  key={transaction.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${transaction.description} transaction details`}
                  onClick={() => setSelected(transaction)}
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
                  <td className="max-w-[230px] px-4 py-3">
                    <div
                      className="truncate text-xs text-[var(--color-muted)]"
                      title={transaction.financial_imports.original_filename}
                    >
                      {transaction.financial_imports.original_filename}
                    </div>
                    <div className="mt-1">
                      <Badge tone={reviewTone(transaction)}>
                        {reviewLabel(transaction)}
                      </Badge>
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

      {selected ? (
        <TransactionDetail
          transaction={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}

function TransactionDetail({
  transaction,
  onClose,
}: {
  transaction: FinancialTransaction;
  onClose: () => void;
}) {
  const matchedDocument = transaction.evidence.some(
    (item) =>
      item.kind === "labour_invoice" || item.kind === "interac_email",
  );
  const noDocumentRequired = transaction.evidence.some(
    (item) => item.kind === "no_document_required",
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-detail-title"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-5 py-4">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge tone={reviewTone(transaction)}>
                {reviewLabel(transaction)}
              </Badge>
              <Badge tone={transactionTone(transaction)}>
                {transactionLabel(transaction)}
              </Badge>
            </div>
            <h2
              id="transaction-detail-title"
              className="font-display text-lg font-semibold text-[var(--color-heading)]"
            >
              {transaction.counterparty ?? transaction.description}
            </h2>
            <p className="mt-0.5 text-sm text-[var(--color-muted)]">
              {formatDate(transaction.posted_on)} ·{" "}
              {transaction.financial_accounts.name} ••••{" "}
              {transaction.financial_accounts.last_four ?? "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close transaction details"
            className="rounded-lg px-2.5 py-1.5 text-xl leading-none text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <DetailValue
              label="Before HST"
              value={formatMoney(transaction.net_amount)}
            />
            <DetailValue
              label="HST"
              value={formatMoney(transaction.tax_amount)}
            />
            <DetailValue
              label="Gross"
              value={formatMoney(transaction.amount)}
              emphasized
            />
          </div>

          <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--color-heading)]">
                Settlement & evidence
              </h3>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                What this transaction pays for and the document that supports it
              </p>
            </div>

            {!matchedDocument &&
            !noDocumentRequired &&
            transaction.review_status !== "reconciled" ? (
              <div className="border-b border-[var(--color-border)] bg-[var(--color-warn-soft)] px-4 py-3">
                <div className="text-sm font-medium text-[var(--color-heading)]">
                  No invoice or receipt matched yet
                </div>
                <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                  This transaction stays in the review queue until its purpose,
                  HST treatment, and supporting evidence are confirmed.
                </div>
              </div>
            ) : null}

            <div className="divide-y divide-[var(--color-border)]">
              {transaction.evidence.map((evidence, index) => (
                <div
                  key={`${evidence.kind}-${evidence.label}-${index}`}
                  className="flex items-start justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[var(--color-heading)]">
                        {evidence.label}
                      </span>
                      <Badge
                        tone={
                          evidence.status === "confirmed" ? "good" : "neutral"
                        }
                      >
                        {evidence.status === "confirmed"
                          ? "Confirmed"
                          : "Source"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                      {evidence.detail}
                    </p>
                    {evidence.filename ? (
                      <p
                        className="mt-1 truncate text-[11px] text-[var(--color-muted)]"
                        title={evidence.filename}
                      >
                        {evidence.filename}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {evidence.amount != null ? (
                      <span className="text-sm font-semibold tabular-nums">
                        {money.format(evidence.amount)}
                      </span>
                    ) : null}
                    {evidence.href ? (
                      <a
                        href={evidence.href}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-medium text-[var(--color-brand-strong)] hover:bg-[var(--color-brand-soft)]"
                      >
                        Open
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 className="text-sm font-semibold text-[var(--color-heading)]">
              Accounting treatment
            </h3>
            <dl className="mt-3 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
              <DetailRow label="Category" value={transaction.category} />
              <DetailRow
                label="Review status"
                value={reviewLabel(transaction)}
              />
              <DetailRow
                label="Transaction date"
                value={formatDate(transaction.transaction_on)}
              />
              <DetailRow
                label="Posted date"
                value={formatDate(transaction.posted_on)}
              />
            </dl>
            {transaction.notes ? (
              <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-xs leading-5 text-[var(--color-muted)]">
                {transaction.notes}
              </p>
            ) : null}
          </section>

          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 className="text-sm font-semibold text-[var(--color-heading)]">
              Bank source
            </h3>
            <dl className="mt-3 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
              <DetailRow
                label="Provider"
                value={transaction.source_details.provider}
              />
              <DetailRow
                label="Import type"
                value={sourceKindLabel(
                  transaction.financial_imports.source_kind,
                )}
              />
              <DetailRow
                label="Bank description"
                value={transaction.description}
              />
              <DetailRow
                label="Bank category"
                value={transaction.source_details.bank_category ?? "—"}
              />
              <DetailRow
                label="Bank reference"
                value={
                  transaction.source_details.reference
                    ? `…${transaction.source_details.reference}`
                    : "—"
                }
              />
              <DetailRow
                label="Feed status"
                value={
                  transaction.source_details.pending ? "Pending" : "Posted"
                }
              />
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

function DetailValue({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div
        className={`mt-1 tabular-nums ${
          emphasized
            ? "text-xl font-semibold text-[var(--color-heading)]"
            : "text-base font-medium"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-muted)]">{label}</dt>
      <dd className="mt-0.5 font-medium text-[var(--color-heading)]">{value}</dd>
    </div>
  );
}
