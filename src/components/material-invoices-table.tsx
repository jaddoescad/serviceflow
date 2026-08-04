"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, EmptyState, Input, Select } from "@/components/ui";
import {
  GENERAL_PAINT_SUPPLIES_LABEL,
  materialClassificationLabel,
} from "@/lib/material-classification";
import type { MaterialInvoiceListRow } from "@/lib/materials";

type JobFilter = "all" | "job" | "general_supplies" | "needs_job";
type PaymentFilter = "all" | "settled" | "open";

const CAD_FORMATTER = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});
const DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function money(value: number) {
  return CAD_FORMATTER.format(value);
}

function date(value: string) {
  return DATE_FORMATTER.format(new Date(`${value}T12:00:00Z`));
}

function jobState(invoice: MaterialInvoiceListRow): Exclude<JobFilter, "all"> {
  if (Math.abs(invoice.jobAllocatedTotal - invoice.totalAmount) > 0.02) {
    return "needs_job";
  }
  if (invoice.jobs.length) return "job";
  if (invoice.overheadCategories.length) return "general_supplies";
  return "needs_job";
}

function paymentState(invoice: MaterialInvoiceListRow): Exclude<PaymentFilter, "all"> {
  return Math.abs(invoice.amountRemaining) <= 0.02 ? "settled" : "open";
}

function settlementLabel(invoice: MaterialInvoiceListRow) {
  if (invoice.totalAmount < 0) {
    return Math.abs(invoice.amountRemaining) <= 0.02
      ? { label: "Credit applied", tone: "good" as const }
      : { label: "Credit open", tone: "warn" as const };
  }
  if (Math.abs(invoice.amountRemaining) <= 0.02) {
    return { label: "Settled", tone: "good" as const };
  }
  if (invoice.paidAmount + invoice.creditAppliedAmount > 0.02) {
    return { label: "Partially settled", tone: "warn" as const };
  }
  return { label: "Unpaid", tone: "neutral" as const };
}

function jobLabel(invoice: MaterialInvoiceListRow) {
  const state = jobState(invoice);
  if (state === "needs_job") {
    return { label: "Needs job", tone: "warn" as const };
  }
  if (state === "general_supplies") {
    return { label: GENERAL_PAINT_SUPPLIES_LABEL, tone: "neutral" as const };
  }
  return {
    label:
      invoice.jobs.length === 1
        ? invoice.jobs[0].name
        : `${invoice.jobs.length} jobs`,
    tone: "good" as const,
  };
}

export function MaterialInvoicesTable({
  invoices,
}: {
  invoices: MaterialInvoiceListRow[];
}) {
  const [supplier, setSupplier] = useState("all");
  const [job, setJob] = useState<JobFilter>("all");
  const [payment, setPayment] = useState<PaymentFilter>("all");
  const [query, setQuery] = useState("");
  const suppliers = useMemo(
    () => [...new Set(invoices.map((invoice) => invoice.supplierName))].sort(),
    [invoices],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("en-CA");
  const filtered = useMemo(
    () =>
      invoices.filter((invoice) => {
        if (supplier !== "all" && invoice.supplierName !== supplier) return false;
        if (job !== "all" && jobState(invoice) !== job) return false;
        if (payment !== "all" && paymentState(invoice) !== payment) return false;
        if (!normalizedQuery) return true;
        return [
          invoice.supplierName,
          invoice.invoiceNumber,
          invoice.poNumber ?? "",
          invoice.documentFilename,
          ...invoice.jobs.map((item) => item.name),
          ...invoice.overheadCategories,
          ...(invoice.overheadCategories.length
            ? [GENERAL_PAINT_SUPPLIES_LABEL]
            : []),
        ]
          .join(" ")
          .toLocaleLowerCase("en-CA")
          .includes(normalizedQuery);
      }),
    [invoices, job, normalizedQuery, payment, supplier],
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
        <Select
          value={supplier}
          onChange={(event) => setSupplier(event.currentTarget.value)}
          aria-label="Filter material invoices by supplier"
          className="h-8 min-w-0 px-2.5 py-1 text-xs sm:w-[220px]"
        >
          <option value="all">All suppliers</option>
          {suppliers.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        <Select
          value={job}
          onChange={(event) => setJob(event.currentTarget.value as JobFilter)}
          aria-label="Filter material invoices by job status"
          className="h-8 min-w-0 px-2.5 py-1 text-xs sm:w-[170px]"
        >
          <option value="all">All job states</option>
          <option value="job">Connected to job</option>
          <option value="general_supplies">General paint supplies</option>
          <option value="needs_job">Needs job</option>
        </Select>
        <Select
          value={payment}
          onChange={(event) =>
            setPayment(event.currentTarget.value as PaymentFilter)
          }
          aria-label="Filter material invoices by payment status"
          className="h-8 min-w-0 px-2.5 py-1 text-xs sm:w-[160px]"
        >
          <option value="all">All settlements</option>
          <option value="settled">Settled</option>
          <option value="open">Open</option>
        </Select>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search invoice, PO, filename, or job"
          aria-label="Search material invoices"
          className="h-8 min-w-0 flex-1 px-2.5 py-1 text-xs sm:min-w-[280px]"
        />
        <Badge tone="neutral">{filtered.length} invoices</Badge>
      </div>

      {filtered.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-[13px]">
            <thead className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-[0.08em] text-[var(--color-muted)]">
              <tr>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Supplier / invoice</th>
                <th className="px-4 py-2.5 font-medium">PO / job</th>
                <th className="px-4 py-2.5 text-right font-medium">Lines</th>
                <th className="px-4 py-2.5 text-right font-medium">Before HST</th>
                <th className="px-4 py-2.5 text-right font-medium">HST</th>
                <th className="px-4 py-2.5 text-right font-medium">After HST</th>
                <th className="px-4 py-2.5 font-medium">Cost classification</th>
                <th className="px-4 py-2.5 font-medium">Settlement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filtered.map((invoice) => {
                const settlement = settlementLabel(invoice);
                const jobStatus = jobLabel(invoice);
                return (
                  <tr
                    key={invoice.id}
                    className="align-top transition-colors hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[var(--color-muted)]">
                      {date(invoice.invoiceDate)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/material-invoices/${encodeURIComponent(invoice.id)}`}
                        className="font-semibold text-[var(--color-heading)] hover:text-[var(--color-brand-strong)] hover:underline"
                      >
                        {invoice.supplierName}
                      </Link>
                      <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                        Invoice #{invoice.invoiceNumber}
                      </div>
                    </td>
                    <td className="max-w-[250px] px-4 py-3">
                      <div className="font-medium text-[var(--color-heading)]">
                        {invoice.poNumber || "No PO"}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
                        {invoice.jobs.map((item) => item.name).join(", ") ||
                          invoice.overheadCategories
                            .map(materialClassificationLabel)
                            .join(", ") ||
                          "No allocation"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {invoice.lineCount}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {money(invoice.amountBeforeTax)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--color-muted)]">
                      {money(invoice.taxAmount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                      {money(invoice.totalAmount)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={jobStatus.tone}>{jobStatus.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={settlement.tone}>{settlement.label}</Badge>
                      {Math.abs(invoice.amountRemaining) > 0.02 ? (
                        <div className="mt-1 text-xs tabular-nums text-[var(--color-muted)]">
                          {money(invoice.amountRemaining)} open
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No material invoices match these filters.</EmptyState>
      )}
    </Card>
  );
}
