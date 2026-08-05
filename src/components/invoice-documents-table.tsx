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
type Tone = "neutral" | "good" | "warn" | "bad" | "brand";
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

const TONE_COLORS: Record<Tone, string> = {
  neutral: "var(--color-muted)",
  good: "var(--color-good)",
  warn: "var(--color-warn)",
  bad: "var(--color-bad)",
  brand: "var(--color-brand-strong)",
};

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
  }).format(value);
}

function invoiceDate(invoice: InvoiceGroup["invoice"]) {
  return invoice.invoice_date ?? invoice.source_date ?? "";
}

function paymentStatus(invoice: InvoiceGroup["invoice"]): {
  label: string;
  tone: Tone;
} {
  if (invoice.payment_status === "paid") return { label: "Paid", tone: "good" };
  if (invoice.payment_status === "partially_paid") {
    return {
      label: `${money(invoice.paid_amount, invoice.currency)} matched`,
      tone: "warn",
    };
  }
  if (invoice.payment_status === "overpaid") {
    return { label: "Overpaid", tone: "bad" };
  }
  return { label: "Unpaid", tone: "neutral" };
}

function evidenceSummary(invoice: InvoiceGroup): { label: string; tone: Tone } {
  if (
    invoice.entries.some(
      (entry) => entry.source_kind === "legacy_invoice_total",
    )
  ) {
    return { label: "Needs extraction", tone: "bad" };
  }
  if (
    invoice.entries.some(
      (entry) => entry.source_kind === "legacy_project_link",
    )
  ) {
    return { label: "Derived items", tone: "warn" };
  }
  if (invoice.entries.every((entry) => entry.source_kind === "extracted")) {
    return { label: "Exact items", tone: "good" };
  }
  return { label: "Manual entry", tone: "brand" };
}

function jobStatusForEntry(entry: InvoiceEntryRecord): Exclude<JobFilter, "all"> {
  if (entry.jobs.length > 0) return "assigned";
  if (entry.invoice.match_status === "overhead_unmatched") return "overhead";
  return "needs_job";
}

function entryMatchesQuery(entry: InvoiceEntryRecord, query: string) {
  return [
    entry.description,
    entry.source_text ?? "",
    ...entry.jobs.flatMap((job) => [job.name, job.address ?? ""]),
  ]
    .join(" ")
    .toLocaleLowerCase("en-CA")
    .includes(query);
}

function quantityLabel(entry: InvoiceEntryRecord) {
  if (entry.quantity_hours != null) return fmtHours(entry.quantity_hours);
  if (entry.quantity != null) {
    return `${entry.quantity.toLocaleString("en-CA")} ${entry.unit ?? ""}`.trim();
  }
  return null;
}

function jobLinkCounts(entries: InvoiceEntryRecord[]) {
  return entries.reduce(
    (counts, entry) => {
      counts[jobStatusForEntry(entry)] += 1;
      return counts;
    },
    { assigned: 0, needs_job: 0, overhead: 0 },
  );
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

function StatusDot({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-[var(--color-text)]">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: TONE_COLORS[tone] }}
      />
      {children}
    </span>
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
  const jobCounts = useMemo(() => jobLinkCounts(entries), [entries]);
  const normalizedQuery = query.trim().toLocaleLowerCase("en-CA");
  const filtered = useMemo(
    () =>
      invoices.flatMap((invoice) => {
        if (owner !== "all" && invoice.invoice.owner_name !== owner) return [];

        const invoiceMatchesQuery = normalizedQuery
          ? [
              invoice.invoice.owner_name,
              invoice.invoice.supplier_name,
              invoice.invoice.invoice_number,
              invoice.invoice.original_filename,
            ]
              .join(" ")
              .toLocaleLowerCase("en-CA")
              .includes(normalizedQuery)
          : true;
        const visibleEntries = invoice.entries.filter((entry) => {
          if (type !== "all" && entry.entry_type !== type) return false;
          if (jobStatus !== "all" && jobStatusForEntry(entry) !== jobStatus) {
            return false;
          }
          return (
            !normalizedQuery ||
            invoiceMatchesQuery ||
            entryMatchesQuery(entry, normalizedQuery)
          );
        });

        return visibleEntries.length ? [{ invoice, visibleEntries }] : [];
      }),
    [invoices, jobStatus, normalizedQuery, owner, type],
  );
  const visibleEntryCount = filtered.reduce(
    (total, result) => total + result.visibleEntries.length,
    0,
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
            aria-label="Filter invoice entries by job-link status"
            className="h-8 min-w-0 flex-1 px-2.5 py-1 text-xs sm:w-[170px]"
          >
            <option value="all">All entries ({entries.length})</option>
            <option value="assigned">
              Connected to job ({jobCounts.assigned})
            </option>
            <option value="needs_job">
              Not connected to job ({jobCounts.needs_job})
            </option>
            <option value="overhead">
              Overhead / no job ({jobCounts.overhead})
            </option>
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
            Expand an invoice to see the job connected to every individual item
          </p>
        </div>
        <Badge tone="neutral">
          {filtered.length} invoices · {visibleEntryCount} entries
        </Badge>
      </div>

      {filtered.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1240px] text-left text-[13px]">
            <thead className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-[0.08em] text-[var(--color-muted)]">
              <tr>
                <th className="w-10 px-3 py-2.5 font-medium" aria-label="Expand" />
                <th className="w-24 px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Invoice owner</th>
                <th className="px-3 py-2.5 font-medium">Supplier / invoice</th>
                <th className="px-3 py-2.5 text-right font-medium">Items</th>
                <th className="px-3 py-2.5 font-medium">Job links</th>
                <th className="border-l border-[var(--color-border)] px-3 py-2.5 text-right font-medium">
                  Before HST
                </th>
                <th className="px-3 py-2.5 text-right font-medium">HST</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  After HST
                </th>
                <th className="border-l border-[var(--color-border)] px-3 py-2.5 font-medium">
                  Payment
                </th>
                <th className="px-3 py-2.5 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filtered.map(({ invoice, visibleEntries }) => {
                const isExpanded =
                  expanded.has(invoice.id) || jobStatus === "needs_job";
                const evidence = evidenceSummary(invoice);
                return (
                  <InvoiceRows
                    key={invoice.id}
                    invoice={invoice}
                    visibleEntries={visibleEntries}
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
        <EmptyState>No invoice entries match these filters.</EmptyState>
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
  visibleEntries,
  expanded,
  evidence,
  onToggle,
}: {
  invoice: InvoiceGroup;
  visibleEntries: InvoiceEntryRecord[];
  expanded: boolean;
  evidence: { label: string; tone: Tone };
  onToggle: () => void;
}) {
  const counts = jobLinkCounts(invoice.entries);
  const payment = paymentStatus(invoice.invoice);

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
          "cursor-pointer align-top outline-none transition-colors hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-brand-soft)]",
          expanded && "bg-[var(--color-surface-2)]",
        )}
      >
        <td className="px-3 py-3.5">
          <span
            aria-hidden="true"
            className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-[var(--color-muted)] transition-transform",
              expanded &&
                "rotate-90 bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]",
            )}
          >
            ›
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-3.5 text-xs tabular-nums text-[var(--color-muted)]">
          {fmtDate(invoiceDate(invoice.invoice))}
        </td>
        <td
          className="max-w-[170px] truncate px-3 py-3.5 text-[var(--color-text)]"
          title={invoice.invoice.owner_name}
        >
          {invoice.invoice.owner_name}
        </td>
        <td className="max-w-[240px] px-3 py-3.5">
          <Link
            href={`/invoices/${encodeURIComponent(invoice.id)}`}
            onClick={(event) => event.stopPropagation()}
            className="text-sm font-medium text-[var(--color-brand-strong)] hover:underline"
          >
            {invoice.invoice.supplier_name}
          </Link>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
            <span>#{invoice.invoice.invoice_number}</span>
            {invoice.invoice.duplicate_group_size > 1 ? (
              <span className="font-medium text-[var(--color-warn)]">
                Duplicate
              </span>
            ) : null}
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-3.5 text-right tabular-nums text-[var(--color-muted)]">
          {visibleEntries.length === invoice.entries.length
            ? invoice.entries.length
            : `${visibleEntries.length} of ${invoice.entries.length}`}
        </td>
        <td className="whitespace-nowrap px-3 py-3.5 text-[11px] font-medium leading-4">
          {counts.assigned ? (
            <div className="text-[var(--color-good)]">
              {counts.assigned} connected
            </div>
          ) : null}
          {counts.needs_job ? (
            <div className="text-[var(--color-warn)]">
              {counts.needs_job} need{counts.needs_job === 1 ? "s" : ""} job
            </div>
          ) : null}
          {counts.overhead ? (
            <div className="text-[var(--color-muted)]">
              {counts.overhead} overhead
            </div>
          ) : null}
        </td>
        <td className="whitespace-nowrap border-l border-[var(--color-border)] px-3 py-3.5 text-right tabular-nums text-[var(--color-text)]">
          {money(
            invoice.invoice.amount_before_tax,
            invoice.invoice.currency,
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-3.5 text-right tabular-nums text-[var(--color-muted)]">
          {money(invoice.invoice.tax_amount, invoice.invoice.currency)}
        </td>
        <td className="whitespace-nowrap px-3 py-3.5 text-right font-semibold tabular-nums text-[var(--color-heading)]">
          {money(
            invoice.invoice.amount_after_tax,
            invoice.invoice.currency,
          )}
        </td>
        <td className="whitespace-nowrap border-l border-[var(--color-border)] px-3 py-3.5">
          <StatusDot tone={payment.tone}>{payment.label}</StatusDot>
          {invoice.invoice.payments.map((paymentLink) => (
            <Link
              key={paymentLink.financial_transaction_id}
              href={`/financials/transactions/${encodeURIComponent(
                paymentLink.financial_transaction_id,
              )}`}
              onClick={(event) => event.stopPropagation()}
              className="mt-1 block pl-3 text-[11px] font-medium text-[var(--color-brand-strong)] hover:underline"
            >
              Bank {fmtDate(paymentLink.posted_on)} →
            </Link>
          ))}
        </td>
        <td className="whitespace-nowrap px-3 py-3.5">
          <StatusDot tone={evidence.tone}>{evidence.label}</StatusDot>
        </td>
      </tr>
      {expanded
        ? visibleEntries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))
        : null}
    </>
  );
}

function EntryRow({ entry }: { entry: InvoiceEntryRecord }) {
  const quantity = quantityLabel(entry);
  return (
    <tr className="bg-[var(--color-bg)] align-top">
      <td className="py-2.5" />
      <td className="py-2.5" />
      <td className="py-2.5" />
      <td className="max-w-[240px] px-3 py-2.5">
        <Link
          href={`/invoices/entries/${encodeURIComponent(entry.id)}`}
          className="font-medium text-[var(--color-text)] hover:text-[var(--color-brand-strong)] hover:underline"
        >
          {entry.description}
        </Link>
        <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
          Item {entry.line_number} ·{" "}
          <span
            className={
              entry.entry_type === "unclassified"
                ? "font-medium text-[var(--color-bad)]"
                : undefined
            }
          >
            {TYPE_LABELS[entry.entry_type]}
          </span>
          {quantity ? ` · ${quantity}` : ""}
        </div>
      </td>
      <td className="py-2.5" />
      <td className="max-w-[220px] px-3 py-2.5 text-[11px] font-medium leading-4">
        {entry.jobs.length ? (
          entry.jobs.map((job) => (
            <div key={job.companycam_project_id} className="truncate">
              <Link
                href={`/jobs/${encodeURIComponent(
                  job.companycam_project_id,
                )}`}
                title={job.address ?? undefined}
                className="text-[var(--color-brand-strong)] hover:underline"
              >
                {job.name}
              </Link>
              {entry.jobs.length > 1 ? (
                <span className="text-[var(--color-muted)] tabular-nums">
                  {" "}
                  · {money(job.allocated_amount, entry.invoice.currency)}
                </span>
              ) : null}
              {job.needs_review ? (
                <span className="text-[var(--color-warn)]"> · review</span>
              ) : null}
            </div>
          ))
        ) : entry.invoice.match_status === "overhead_unmatched" ? (
          <span className="text-[var(--color-muted)]">Overhead</span>
        ) : (
          <span className="text-[var(--color-warn)]">Needs job link</span>
        )}
      </td>
      <td className="whitespace-nowrap border-l border-[var(--color-border)] px-3 py-2.5 text-right tabular-nums text-[var(--color-text)]">
        {money(entry.amount_before_tax, entry.invoice.currency)}
      </td>
      <td className="py-2.5" />
      <td className="py-2.5" />
      <td className="border-l border-[var(--color-border)] py-2.5" />
      <td className="py-2.5" />
    </tr>
  );
}
