"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, EmptyState, Input, Select, cn } from "@/components/ui";
import { fmtDate, fmtHours } from "@/lib/format";
import type {
  InvoiceEntryRecord,
  InvoiceEntryType,
} from "@/lib/invoice-entry-queries";

type TypeFilter = "all" | InvoiceEntryType;
type JobFilter = "all" | "assigned" | "needs_job" | "overhead";
type InvoiceGroup = {
  id: string;
  invoice: InvoiceEntryRecord["invoice"];
  entries: InvoiceEntryRecord[];
};

const TYPE_LABELS: Record<InvoiceEntryType, string> = {
  labour: "Labour",
  material: "Materials",
  bonus: "Bonuses",
  commission: "Commissions",
  expense: "Expenses",
  other: "Other",
  unclassified: "Unclassified",
};

const TYPE_ORDER: InvoiceEntryType[] = [
  "labour",
  "material",
  "bonus",
  "commission",
  "expense",
  "other",
  "unclassified",
];

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
  }).format(value);
}

function invoiceDate(invoice: InvoiceGroup["invoice"]) {
  return invoice.invoice_date ?? invoice.source_date ?? "";
}

function paymentLabel(invoice: InvoiceGroup["invoice"]) {
  if (invoice.payment_status === "paid") return "Paid";
  if (invoice.payment_status === "partially_paid") {
    return `${money(invoice.paid_amount, invoice.currency)} matched`;
  }
  if (invoice.payment_status === "overpaid") return "Overpaid";
  return "Unpaid";
}

function evidenceSummary(invoice: InvoiceGroup) {
  if (
    invoice.entries.some(
      (entry) => entry.source_kind === "legacy_invoice_total",
    )
  ) {
    return { label: "Items need extraction", tone: "bad" as const };
  }
  if (
    invoice.entries.some(
      (entry) => entry.source_kind === "legacy_project_link",
    )
  ) {
    return { label: "Derived items", tone: "warn" as const };
  }
  if (invoice.entries.every((entry) => entry.source_kind === "extracted")) {
    return { label: "Exact source items", tone: "good" as const };
  }
  return { label: "Manually entered", tone: "brand" as const };
}

function groupInvoices(entries: InvoiceEntryRecord[]): InvoiceGroup[] {
  const groups = new Map<string, InvoiceGroup>();
  for (const entry of entries) {
    const group = groups.get(entry.invoice_id);
    if (group) {
      group.entries.push(entry);
    } else {
      groups.set(entry.invoice_id, {
        id: entry.invoice_id,
        invoice: entry.invoice,
        entries: [entry],
      });
    }
  }
  return [...groups.values()].sort(
    (left, right) =>
      invoiceDate(right.invoice).localeCompare(invoiceDate(left.invoice)) ||
      right.invoice.invoice_number.localeCompare(
        left.invoice.invoice_number,
        "en-CA",
        { numeric: true },
      ),
  );
}

export function InvoiceDocumentsTable({
  entries,
}: {
  entries: InvoiceEntryRecord[];
}) {
  const invoices = useMemo(() => groupInvoices(entries), [entries]);
  const [type, setType] = useState<TypeFilter>("all");
  const [owner, setOwner] = useState("all");
  const [jobStatus, setJobStatus] = useState<JobFilter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const counts = useMemo(
    () =>
      Object.fromEntries(
        TYPE_ORDER.map((entryType) => [
          entryType,
          invoices.filter((invoice) =>
            invoice.entries.some(
              (entry) => entry.entry_type === entryType,
            ),
          ).length,
        ]),
      ) as Record<InvoiceEntryType, number>,
    [invoices],
  );
  const owners = useMemo(
    () =>
      [...new Set(invoices.map((invoice) => invoice.invoice.owner_name))].sort(
        (left, right) => left.localeCompare(right, "en-CA"),
      ),
    [invoices],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("en-CA");
  const filtered = useMemo(
    () =>
      invoices.filter((invoice) => {
        if (
          type !== "all" &&
          !invoice.entries.some((entry) => entry.entry_type === type)
        ) {
          return false;
        }
        if (
          owner !== "all" &&
          invoice.invoice.owner_name !== owner
        ) {
          return false;
        }
        const hasAssignedEntry = invoice.entries.some(
          (entry) => entry.jobs.length > 0,
        );
        const hasOverheadEntry = invoice.entries.some(
          (entry) =>
            entry.jobs.length === 0 &&
            entry.invoice.match_status === "overhead_unmatched",
        );
        const hasEntryNeedingJob = invoice.entries.some(
          (entry) =>
            entry.jobs.length === 0 &&
            entry.invoice.match_status !== "overhead_unmatched",
        );
        if (jobStatus === "assigned" && !hasAssignedEntry) return false;
        if (jobStatus === "needs_job" && !hasEntryNeedingJob) return false;
        if (jobStatus === "overhead" && !hasOverheadEntry) return false;
        if (!normalizedQuery) return true;
        return [
          invoice.invoice.owner_name,
          invoice.invoice.supplier_name,
          invoice.invoice.invoice_number,
          invoice.invoice.original_filename,
          ...invoice.entries.flatMap((entry) => [
            entry.description,
            ...entry.jobs.flatMap((job) => [
              job.name,
              job.address ?? "",
            ]),
          ]),
        ]
          .join(" ")
          .toLocaleLowerCase("en-CA")
          .includes(normalizedQuery);
      }),
    [invoices, jobStatus, normalizedQuery, owner, type],
  );

  const toggle = (invoiceId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(invoiceId)) next.delete(invoiceId);
      else next.add(invoiceId);
      return next;
    });
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          <FilterButton
            active={type === "all"}
            onClick={() => setType("all")}
          >
            All <span className="tabular-nums">{invoices.length}</span>
          </FilterButton>
          {TYPE_ORDER.filter((entryType) => counts[entryType] > 0).map(
            (entryType) => (
              <FilterButton
                key={entryType}
                active={type === entryType}
                onClick={() => setType(entryType)}
              >
                {TYPE_LABELS[entryType]}{" "}
                <span className="tabular-nums">{counts[entryType]}</span>
              </FilterButton>
            ),
          )}
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Select
            value={jobStatus}
            onChange={(event) =>
              setJobStatus(event.currentTarget.value as JobFilter)
            }
            aria-label="Filter invoices by job-link status"
            className="h-8 min-w-0 flex-1 px-2.5 py-1 text-xs sm:w-[170px]"
          >
            <option value="all">All job links</option>
            <option value="assigned">Has job</option>
            <option value="needs_job">Needs job link</option>
            <option value="overhead">Overhead / no job</option>
          </Select>
          <Select
            value={owner}
            onChange={(event) => setOwner(event.currentTarget.value)}
            aria-label="Filter invoices by owner"
            className="h-8 min-w-0 flex-1 px-2.5 py-1 text-xs sm:w-[210px]"
          >
            <option value="all">All invoice owners</option>
            {owners.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search owner, supplier, invoice, item, or job"
            aria-label="Search invoices"
            className="h-8 min-w-0 flex-1 px-2.5 py-1 text-xs sm:w-[330px]"
          />
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-[var(--color-heading)]">
            Invoices
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            Click an invoice to expand its individual items
          </p>
        </div>
        <Badge tone="neutral">
          {filtered.length} of {invoices.length}
        </Badge>
      </div>

      {filtered.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1220px] text-left text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-xs uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th className="w-10 px-4 py-3 font-medium" aria-label="Expand" />
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Invoice owner</th>
                <th className="px-4 py-3 font-medium">Supplier / invoice</th>
                <th className="px-4 py-3 text-right font-medium">Items</th>
                <th className="px-4 py-3 text-right font-medium">
                  Before HST
                </th>
                <th className="px-4 py-3 text-right font-medium">HST</th>
                <th className="px-4 py-3 text-right font-medium">
                  After HST
                </th>
                <th className="px-4 py-3 font-medium">Payment</th>
                <th className="px-4 py-3 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filtered.map((invoice) => {
                const isExpanded = expanded.has(invoice.id);
                const evidence = evidenceSummary(invoice);
                return (
                  <InvoiceRows
                    key={invoice.id}
                    invoice={invoice}
                    expanded={isExpanded}
                    evidence={evidence}
                    onToggle={() => toggle(invoice.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No invoices match these filters.</EmptyState>
      )}
    </Card>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-[var(--color-brand)] text-[var(--color-brand-ink)]"
          : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]",
      )}
    >
      {children}
    </button>
  );
}

function InvoiceRows({
  invoice,
  expanded,
  evidence,
  onToggle,
}: {
  invoice: InvoiceGroup;
  expanded: boolean;
  evidence: ReturnType<typeof evidenceSummary>;
  onToggle: () => void;
}) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onToggle();
  };

  return (
    <>
      <tr
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={handleKeyDown}
        className={cn(
          "cursor-pointer align-top outline-none hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-brand-soft)]",
          expanded && "bg-[var(--color-surface-2)]",
        )}
      >
        <td className="px-4 py-3 text-[var(--color-brand-strong)]">
          <span aria-hidden="true">{expanded ? "▾" : "›"}</span>
        </td>
        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[var(--color-muted)]">
          {fmtDate(invoiceDate(invoice.invoice))}
        </td>
        <td className="max-w-[190px] px-4 py-3 font-medium text-[var(--color-heading)]">
          {invoice.invoice.owner_name}
        </td>
        <td className="max-w-[240px] px-4 py-3">
          <Link
            href={`/invoices/${encodeURIComponent(invoice.id)}`}
            onClick={(event) => event.stopPropagation()}
            className="font-medium text-[var(--color-brand-strong)] hover:underline"
          >
            {invoice.invoice.supplier_name}
          </Link>
          <div className="mt-0.5 text-xs text-[var(--color-muted)]">
            Invoice #{invoice.invoice.invoice_number}
          </div>
          {invoice.invoice.duplicate_group_size > 1 ? (
            <div className="mt-1">
              <Badge tone="warn">Version / duplicate</Badge>
            </div>
          ) : null}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {invoice.entries.length}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
          {money(
            invoice.invoice.amount_before_tax,
            invoice.invoice.currency,
          )}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
          {money(invoice.invoice.tax_amount, invoice.invoice.currency)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
          {money(
            invoice.invoice.amount_after_tax,
            invoice.invoice.currency,
          )}
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          <Badge
            tone={
              invoice.invoice.payment_status === "paid"
                ? "good"
                : invoice.invoice.payment_status === "partially_paid"
                  ? "warn"
                  : invoice.invoice.payment_status === "overpaid"
                    ? "bad"
                    : "neutral"
            }
          >
            {paymentLabel(invoice.invoice)}
          </Badge>
          {invoice.invoice.payments.map((payment) => (
            <Link
              key={payment.financial_transaction_id}
              href={`/financials/transactions/${encodeURIComponent(
                payment.financial_transaction_id,
              )}`}
              onClick={(event) => event.stopPropagation()}
              className="mt-1 block text-[11px] font-medium text-[var(--color-brand-strong)] hover:underline"
            >
              Bank {fmtDate(payment.posted_on)} →
            </Link>
          ))}
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          <Badge tone={evidence.tone}>{evidence.label}</Badge>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={10} className="bg-[var(--color-bg)] px-6 py-4">
            <InvoiceItems invoice={invoice} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function InvoiceItems({ invoice }: { invoice: InvoiceGroup }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-[var(--color-heading)]">
            Invoice items
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-muted)]">
            {invoice.invoice.original_filename}
          </div>
        </div>
        <Link
          href={`/invoices/${encodeURIComponent(invoice.id)}`}
          onClick={(event) => event.stopPropagation()}
          className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
        >
          View full invoice + source →
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th className="px-4 py-2.5 font-medium">Item</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">Job</th>
              <th className="px-4 py-2.5 text-right font-medium">
                Hours / quantity
              </th>
              <th className="px-4 py-2.5 text-right font-medium">
                Before HST
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {invoice.entries.map((entry) => (
              <tr key={entry.id} className="align-top">
                <td className="max-w-[360px] px-4 py-3">
                  <Link
                    href={`/invoices/entries/${encodeURIComponent(entry.id)}`}
                    onClick={(event) => event.stopPropagation()}
                    className="font-medium text-[var(--color-brand-strong)] hover:underline"
                  >
                    {entry.description}
                  </Link>
                  <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                    Item {entry.line_number}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge
                    tone={
                      entry.entry_type === "unclassified"
                        ? "bad"
                        : "neutral"
                    }
                  >
                    {TYPE_LABELS[entry.entry_type]}
                  </Badge>
                </td>
                <td className="max-w-[300px] px-4 py-3">
                  {entry.jobs.length ? (
                    entry.jobs.map((job) => (
                        <div key={job.companycam_project_id}>
                          <Link
                            href={`/projects/${encodeURIComponent(
                              job.companycam_project_id,
                            )}`}
                            onClick={(event) => event.stopPropagation()}
                            className="font-medium text-[var(--color-brand-strong)] hover:underline"
                          >
                            {job.name}
                          </Link>
                          <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                            {money(
                              job.allocated_amount,
                              entry.invoice.currency,
                            )}{" "}
                            allocated
                          </div>
                        </div>
                      ))
                  ) : entry.invoice.match_status ===
                    "overhead_unmatched" ? (
                    <Badge tone="neutral">Overhead / no job</Badge>
                  ) : (
                    <Badge tone="warn">Needs job link</Badge>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {entry.quantity_hours != null
                    ? fmtHours(entry.quantity_hours)
                    : entry.quantity != null
                      ? `${entry.quantity.toLocaleString("en-CA")} ${
                          entry.unit ?? ""
                        }`.trim()
                      : "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                  {money(
                    entry.amount_before_tax,
                    entry.invoice.currency,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
