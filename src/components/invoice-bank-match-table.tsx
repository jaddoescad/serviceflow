"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, Input, cn } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import type {
  InvoiceBankMatchProposal,
  InvoiceBankMatchReport,
  MatchQueue,
  UnmatchedMatchItem,
} from "@/lib/invoice-bank-matcher";

const QUEUES: Array<{
  id: MatchQueue;
  label: string;
  description: string;
}> = [
  {
    id: "ready_to_confirm",
    label: "Ready to confirm",
    description: "Exact amount and confirmed recipient",
  },
  {
    id: "combined_or_split",
    label: "Combined / split",
    description: "Multiple invoices, payments, or an amount difference",
  },
  {
    id: "recipient_confirmation",
    label: "Confirm recipient",
    description: "Exact amount, but bank recipient is not verified",
  },
  {
    id: "no_candidate",
    label: "No candidate",
    description: "Missing evidence or no defensible match",
  },
];

const currency = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number) {
  return currency.format(value);
}

function kindLabel(kind: InvoiceBankMatchProposal["kind"]) {
  return {
    exact_one_to_one: "One invoice ↔ one payment",
    combined_invoices: "Invoices combined",
    split_payment: "Payment split",
    partial_payment: "Possible partial payment",
    possible_overpayment: "Possible overpayment",
    recipient_unknown_exact: "Recipient needs confirmation",
  }[kind];
}

function proposalText(proposal: InvoiceBankMatchProposal) {
  return [
    proposal.supplierName,
    proposal.kind,
    ...proposal.invoices.flatMap((invoice) => [
      invoice.invoiceNumber,
      invoice.originalFilename,
    ]),
    ...proposal.payments.flatMap((payment) => [
      payment.description,
      payment.counterparty ?? "",
      payment.recipientName ?? "",
      payment.recipientEmail ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function unmatchedText(item: UnmatchedMatchItem) {
  return [
    item.supplierName,
    item.reason,
    item.invoice?.invoiceNumber ?? "",
    item.invoice?.originalFilename ?? "",
    item.payment?.description ?? "",
    item.payment?.counterparty ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

export function InvoiceBankMatchTable({
  report,
}: {
  report: InvoiceBankMatchReport;
}) {
  const [queue, setQueue] = useState<MatchQueue>("ready_to_confirm");
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const counts: Record<MatchQueue, number> = {
    ready_to_confirm: report.proposals.filter(
      (proposal) => proposal.queue === "ready_to_confirm",
    ).length,
    combined_or_split: report.proposals.filter(
      (proposal) => proposal.queue === "combined_or_split",
    ).length,
    recipient_confirmation: report.proposals.filter(
      (proposal) => proposal.queue === "recipient_confirmation",
    ).length,
    no_candidate: report.unmatched.length,
  };

  const rows = useMemo(() => {
    if (queue === "no_candidate") {
      return report.unmatched.filter(
        (item) => !normalizedSearch || unmatchedText(item).includes(normalizedSearch),
      );
    }
    return report.proposals.filter(
      (proposal) =>
        proposal.queue === queue &&
        (!normalizedSearch || proposalText(proposal).includes(normalizedSearch)),
    );
  }, [normalizedSearch, queue, report.proposals, report.unmatched]);

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {QUEUES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setQueue(option.id)}
              title={option.description}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                queue === option.id
                  ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
                  : "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
              )}
            >
              {option.label}
              <span className="tabular-nums">{counts[option.id]}</span>
            </button>
          ))}
          <div className="ml-auto w-full sm:w-64">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search contractor or number"
              className="h-8 py-1 text-xs"
              aria-label="Search settlement candidates"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-xs uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Contractor / match</th>
              <th className="px-4 py-3 font-medium">Invoice evidence</th>
              <th className="px-4 py-3 font-medium">Bank evidence</th>
              <th className="px-4 py-3 text-right font-medium">Invoice</th>
              <th className="px-4 py-3 text-right font-medium">Bank</th>
              <th className="px-4 py-3 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.map((row) =>
              "kind" in row ? (
                <ProposalRow key={row.id} proposal={row} />
              ) : (
                <UnmatchedRow key={row.id} item={row} />
              ),
            )}
          </tbody>
        </table>
      </div>

      {!rows.length ? (
        <div className="border-t border-[var(--color-border)] px-4 py-10 text-center text-sm text-[var(--color-muted)]">
          No records in this queue{normalizedSearch ? " match your search" : ""}.
        </div>
      ) : (
        <div className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted)]">
          {rows.length} record{rows.length === 1 ? "" : "s"} · suggestions only,
          no payment status changed
        </div>
      )}
    </Card>
  );
}

function ProposalRow({
  proposal,
}: {
  proposal: InvoiceBankMatchProposal;
}) {
  return (
    <tr className="align-top hover:bg-[var(--color-surface-2)]">
      <td className="px-4 py-3">
        <Link
          href={`/settlements/${encodeURIComponent(proposal.id)}`}
          className="font-medium text-[var(--color-heading)] hover:text-[var(--color-brand-strong)] hover:underline"
        >
          {proposal.supplierName}
        </Link>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge tone={proposal.confidence === "high" ? "good" : "warn"}>
            {proposal.confidence} confidence
          </Badge>
          <Badge tone="neutral">{kindLabel(proposal.kind)}</Badge>
        </div>
      </td>
      <td className="px-4 py-3 text-xs">
        {proposal.invoices.map((invoice) => (
          <div key={invoice.id}>
            <Link
              href={`/invoices/${encodeURIComponent(invoice.id)}`}
              className="font-medium text-[var(--color-brand-strong)] hover:underline"
            >
              #{invoice.invoiceNumber}
            </Link>{" "}
            · {fmtDate(invoice.invoiceDate)}
          </div>
        ))}
      </td>
      <td className="px-4 py-3 text-xs">
        {proposal.payments.map((payment) => (
          <div key={payment.id}>
            <Link
              href={`/financials/transactions/${encodeURIComponent(payment.id)}`}
              className="font-medium text-[var(--color-brand-strong)] hover:underline"
            >
              {fmtDate(payment.postedOn)}
            </Link>{" "}
            · {payment.accountName}
          </div>
        ))}
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {money(proposal.invoiceAmount)}
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {money(proposal.paymentAmount)}
      </td>
      <td
        className={cn(
          "px-4 py-3 text-right font-semibold tabular-nums",
          Math.abs(proposal.difference) < 0.005
            ? "text-[var(--color-good)]"
            : "text-[var(--color-warn)]",
        )}
      >
        {money(proposal.difference)}
      </td>
    </tr>
  );
}

function UnmatchedRow({ item }: { item: UnmatchedMatchItem }) {
  const invoice = item.invoice;
  const payment = item.payment;
  return (
    <tr className="align-top hover:bg-[var(--color-surface-2)]">
      <td className="px-4 py-3">
        <div className="font-medium text-[var(--color-heading)]">
          {item.supplierName}
        </div>
        <div className="mt-1 max-w-sm text-xs text-[var(--color-muted)]">
          {item.reason}
        </div>
      </td>
      <td className="px-4 py-3 text-xs">
        {invoice ? (
          <Link
            href={`/invoices/${encodeURIComponent(invoice.id)}`}
            className="font-medium text-[var(--color-brand-strong)] hover:underline"
          >
            #{invoice.invoiceNumber} · {fmtDate(invoice.invoiceDate)}
          </Link>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3 text-xs">
        {payment ? (
          <Link
            href={`/financials/transactions/${encodeURIComponent(payment.id)}`}
            className="font-medium text-[var(--color-brand-strong)] hover:underline"
          >
            {fmtDate(payment.postedOn)} · {payment.description}
          </Link>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {invoice ? money(invoice.remainingAmount) : "—"}
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {payment ? money(payment.availableAmount) : "—"}
      </td>
      <td className="px-4 py-3 text-right text-[var(--color-muted)]">—</td>
    </tr>
  );
}
