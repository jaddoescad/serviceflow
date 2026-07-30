"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, EmptyState, Input, Select } from "@/components/ui";
import { fmtDate, fmtHours } from "@/lib/format";
import type {
  InvoiceEntryRecord,
  InvoiceEntryType,
} from "@/lib/invoice-entry-queries";

type TypeFilter = "all" | InvoiceEntryType;

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

function evidenceLabel(entry: InvoiceEntryRecord) {
  if (entry.source_kind === "extracted") return "Exact source entry";
  if (entry.source_kind === "manual") return "Manually entered";
  if (entry.source_kind === "legacy_project_link") {
    return "Derived from job match";
  }
  return "Exact lines needed";
}

function evidenceTone(
  entry: InvoiceEntryRecord,
): "good" | "brand" | "warn" | "bad" {
  if (entry.source_kind === "extracted") return "good";
  if (entry.source_kind === "manual") return "brand";
  if (entry.source_kind === "legacy_project_link") return "warn";
  return "bad";
}

function paymentLabel(entry: InvoiceEntryRecord) {
  if (entry.invoice.payment_status === "paid") return "Paid";
  if (entry.invoice.payment_status === "partially_paid") {
    return `${money(
      entry.invoice.paid_amount,
      entry.invoice.currency,
    )} matched`;
  }
  if (entry.invoice.payment_status === "overpaid") return "Overpaid";
  return "Unpaid";
}

export function InvoiceEntriesTable({
  entries,
  initialType = "labour",
  title = "Invoice entries",
  subtitle = "Each row is one item inside an archived source invoice",
  showJobs = true,
}: {
  entries: InvoiceEntryRecord[];
  initialType?: TypeFilter;
  title?: string;
  subtitle?: string;
  showJobs?: boolean;
}) {
  const [type, setType] = useState<TypeFilter>(initialType);
  const [owner, setOwner] = useState("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(
    () =>
      Object.fromEntries(
        TYPE_ORDER.map((entryType) => [
          entryType,
          entries.filter((entry) => entry.entry_type === entryType).length,
        ]),
      ) as Record<InvoiceEntryType, number>,
    [entries],
  );

  const visibleTypes = TYPE_ORDER.filter(
    (entryType) => counts[entryType] > 0,
  );
  const owners = useMemo(
    () =>
      [...new Set(entries.map((entry) => entry.invoice.owner_name))].sort(
        (left, right) => left.localeCompare(right, "en-CA"),
      ),
    [entries],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("en-CA");
  const filtered = useMemo(
    () =>
      entries.filter((entry) => {
        if (type !== "all" && entry.entry_type !== type) return false;
        if (owner !== "all" && entry.invoice.owner_name !== owner) return false;
        if (!normalizedQuery) return true;
        return [
          entry.description,
          entry.invoice.owner_name,
          entry.invoice.supplier_name,
          entry.invoice.invoice_number,
          ...entry.jobs.flatMap((job) => [job.name, job.address ?? ""]),
        ]
          .join(" ")
          .toLocaleLowerCase("en-CA")
          .includes(normalizedQuery);
      }),
    [entries, normalizedQuery, owner, type],
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setType("all")}
            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              type === "all"
                ? "bg-[var(--color-brand)] text-[var(--color-brand-ink)]"
                : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            All <span className="tabular-nums">{entries.length}</span>
          </button>
          {visibleTypes.map((entryType) => (
            <button
              key={entryType}
              type="button"
              onClick={() => setType(entryType)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                type === entryType
                  ? "bg-[var(--color-brand)] text-[var(--color-brand-ink)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              {TYPE_LABELS[entryType]}{" "}
              <span className="tabular-nums">{counts[entryType]}</span>
            </button>
          ))}
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
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
            placeholder="Search supplier, invoice, entry, or job"
            aria-label="Search invoice entries"
            className="h-8 min-w-0 flex-1 px-2.5 py-1 text-xs sm:w-[310px]"
          />
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-[var(--color-heading)]">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">{subtitle}</p>
        </div>
        <Badge tone="neutral">
          {filtered.length} of {entries.length}
        </Badge>
      </div>

      {filtered.length ? (
        <div className="overflow-x-auto">
          <table
            className={`w-full text-left text-sm ${
              showJobs ? "min-w-[1420px]" : "min-w-[1180px]"
            }`}
          >
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-xs uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Supplier / invoice</th>
                <th className="px-4 py-3 font-medium">Entry</th>
                {showJobs ? (
                  <th className="px-4 py-3 font-medium">Job</th>
                ) : null}
                <th className="px-4 py-3 text-right font-medium">
                  Hours / quantity
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  Before HST
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  After HST
                </th>
                <th className="px-4 py-3 font-medium">Payment</th>
                <th className="px-4 py-3 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filtered.map((entry) => (
                <tr
                  key={entry.id}
                  className="align-top hover:bg-[var(--color-surface-2)]"
                >
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[var(--color-muted)]">
                    {fmtDate(
                      entry.service_started_on ??
                        entry.invoice.invoice_date ??
                        entry.invoice.source_date,
                    )}
                  </td>
                  <td className="max-w-[220px] px-4 py-3">
                    <div className="font-medium text-[var(--color-heading)]">
                      {entry.invoice.supplier_name}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                      Invoice #{entry.invoice.invoice_number}
                    </div>
                    {entry.invoice.duplicate_group_size > 1 ? (
                      <div className="mt-1">
                        <Badge tone="warn">Version / duplicate</Badge>
                      </div>
                    ) : null}
                  </td>
                  <td className="max-w-[330px] px-4 py-3">
                    <Link
                      href={`/invoices/entries/${encodeURIComponent(entry.id)}`}
                      className="font-medium text-[var(--color-brand-strong)] hover:underline"
                    >
                      {entry.description}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge
                        tone={
                          entry.entry_type === "unclassified"
                            ? "bad"
                            : "neutral"
                        }
                      >
                        {TYPE_LABELS[entry.entry_type]}
                      </Badge>
                      <span className="text-[11px] text-[var(--color-muted)]">
                        Entry {entry.line_number}
                      </span>
                    </div>
                  </td>
                  {showJobs ? (
                    <td className="max-w-[280px] px-4 py-3">
                      {entry.jobs.length ? (
                        <div className="space-y-1.5">
                          {entry.jobs.map((job) => (
                            <div key={job.companycam_project_id}>
                              <Link
                                href={`/projects/${encodeURIComponent(
                                  job.companycam_project_id,
                                )}`}
                                className="font-medium text-[var(--color-brand-strong)] hover:underline"
                              >
                                {job.name}
                              </Link>
                              {job.address ? (
                                <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                                  {job.address}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[var(--color-muted)]">
                          Not assigned
                        </span>
                      )}
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {entry.quantity_hours != null
                      ? fmtHours(entry.quantity_hours)
                      : entry.quantity != null
                        ? `${entry.quantity.toLocaleString("en-CA")} ${
                            entry.unit ?? ""
                          }`.trim()
                        : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                    {money(
                      entry.amount_before_tax,
                      entry.invoice.currency,
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                    {money(
                      entry.after_hst_amount,
                      entry.invoice.currency,
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge
                      tone={
                        entry.invoice.payment_status === "paid"
                          ? "good"
                          : entry.invoice.payment_status === "partially_paid"
                            ? "warn"
                            : entry.invoice.payment_status === "overpaid"
                              ? "bad"
                              : "neutral"
                      }
                    >
                      {paymentLabel(entry)}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={evidenceTone(entry)}>
                      {evidenceLabel(entry)}
                    </Badge>
                    <div className="mt-1">
                      <Link
                        href={`/invoices/entries/${encodeURIComponent(entry.id)}`}
                        className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
                      >
                        View entry + invoice →
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No invoice entries match these filters.</EmptyState>
      )}
    </Card>
  );
}
