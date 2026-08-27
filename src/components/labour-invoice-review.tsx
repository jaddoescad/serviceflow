"use client";

import * as React from "react";
import Link from "next/link";
import { Button, Card, EmptyState, Input, Select, StatusText, cn } from "@/components/ui";
import { fmtDate, fmtMonthYear } from "@/lib/format";
import {
  labourCostPercent,
  labourCostTone,
  type LabourCostTone,
} from "@/lib/labour-cost-percentages";
import {
  invoicePaymentLabel,
  invoicePaymentTone,
  invoiceReviewLabel,
  invoiceReviewTone,
  type InvoicePaymentState,
  type InvoiceReviewState,
} from "@/lib/invoice-readiness";

type SummaryFilter = InvoicePaymentState | "needs_review";

const SUMMARY_FILTERS: SummaryFilter[] = ["unpaid", "sent_pending", "paid", "void", "needs_review"];

const STATE_VALUE_TONE: Record<SummaryFilter, string> = {
  unpaid: "text-[var(--color-brand-strong)]",
  sent_pending: "text-[var(--color-warn)]",
  paid: "text-[var(--color-good)]",
  void: "text-[var(--color-muted)]",
  needs_review: "text-[var(--color-warn)]",
};

function summaryLabel(filter: SummaryFilter): string {
  return filter === "needs_review" ? "Needs review" : invoicePaymentLabel(filter);
}

function money(cents: number | string | null | undefined, currency = "CAD") {
  const value = Number(cents ?? 0) / 100;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function contactName(invoice: any): string {
  const contact = Array.isArray(invoice.contact) ? invoice.contact[0] : invoice.contact;
  return contact?.name?.trim() || "Unassigned supplier";
}

function jobDisplayName(job: any, fallback?: string): string {
  const sourceName = job?.name ?? fallback ?? "Unknown job";
  return String(sourceName).replace(/\s+-\s+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/, "");
}

function jobNames(invoice: any): string[] {
  const names = (invoice.allocations ?? [])
    .map((allocation: any) => {
      const job = Array.isArray(allocation.job) ? allocation.job[0] : allocation.job;
      return jobDisplayName(job, allocation.job_id);
    })
    .filter(Boolean) as string[];
  return [...new Set(names)];
}

type InvoiceDestination = {
  key: string;
  name: string;
  subtotalCents: number;
  jobRevenueBeforeHstCents: number | null;
  totalLabourSubtotalCents: number | null;
  productionMonth: string | null;
};

function invoiceDestinations(invoice: any): InvoiceDestination[] {
  const byJob = new Map<string, InvoiceDestination>();
  for (const allocation of invoice.allocations ?? []) {
    const job = Array.isArray(allocation.job) ? allocation.job[0] : allocation.job;
    const key = allocation.job_id ?? job?.name;
    if (!key) continue;
    const current = byJob.get(key) ?? {
      key,
      name: jobDisplayName(job),
      subtotalCents: 0,
      jobRevenueBeforeHstCents:
        allocation.job_revenue_before_hst_cents == null
          ? null
          : Number(allocation.job_revenue_before_hst_cents),
      totalLabourSubtotalCents:
        allocation.total_job_labour_subtotal_cents == null
          ? null
          : Number(allocation.total_job_labour_subtotal_cents),
      productionMonth: job?.production_month ?? null,
    };
    current.subtotalCents += Number(allocation.subtotal_cents ?? 0);
    if (!current.productionMonth && job?.production_month) {
      current.productionMonth = job.production_month;
    }
    byJob.set(key, current);
  }

  const destinations = [...byJob.values()];
  const companyExpense = Math.max(
    Number(invoice.subtotal_cents ?? 0) -
      Number(invoice.readiness?.allocationTargetSubtotalCents ?? 0),
    0,
  );
  if (companyExpense > 0) {
    destinations.push({
      key: "company-expense",
      name: "Company expense",
      subtotalCents: companyExpense,
      jobRevenueBeforeHstCents: null,
      totalLabourSubtotalCents: null,
      productionMonth: null,
    });
  }
  const unassigned = Math.max(
    Number(invoice.readiness?.allocationVarianceCents ?? 0),
    0,
  );
  if (unassigned > 0) {
    destinations.push({
      key: "unassigned",
      name: "Unassigned",
      subtotalCents: unassigned,
      jobRevenueBeforeHstCents: null,
      totalLabourSubtotalCents: null,
      productionMonth: null,
    });
  }
  return destinations;
}

const LABOUR_PERCENT_TONE: Record<LabourCostTone, string> = {
  good: "bg-[var(--color-good-soft)] text-[var(--color-good)]",
  neutral: "bg-[var(--color-surface-2)] text-[var(--color-heading)]",
  bad: "bg-[var(--color-bad-soft)] text-[var(--color-bad)]",
};

function percent(value: number): string {
  return `${new Intl.NumberFormat("en-CA", {
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

function DestinationLabourPercentages({
  destination,
  currency,
  muted,
}: {
  destination: InvoiceDestination;
  currency: string;
  muted: boolean;
}) {
  if (destination.key === "company-expense" || destination.key === "unassigned") {
    return null;
  }
  const invoicePercent = labourCostPercent(
    destination.subtotalCents,
    destination.jobRevenueBeforeHstCents,
  );
  const totalPercent = labourCostPercent(
    destination.totalLabourSubtotalCents ?? 0,
    destination.jobRevenueBeforeHstCents,
  );
  if (invoicePercent == null || totalPercent == null) {
    return (
      <div className="mt-1 text-[10px] text-[var(--color-muted)]">
        Labour % unavailable — no validated DripJobs job amount
      </div>
    );
  }
  const tone = labourCostTone(totalPercent);
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]"
      title={`Percent of ${money(destination.jobRevenueBeforeHstCents, currency)} validated DripJobs job amount before HST`}
    >
      <span className="tabular-nums text-[var(--color-muted)]">
        This invoice {percent(invoicePercent)}
      </span>
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 font-semibold tabular-nums",
          muted
            ? "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
            : LABOUR_PERCENT_TONE[tone],
        )}
      >
        Total labour {percent(totalPercent)}
      </span>
    </div>
  );
}

function SummaryCard({
  filter,
  label,
  count,
  hint,
  active,
  onClick,
}: {
  filter: SummaryFilter;
  label: string;
  count: number;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{ borderRadius: "var(--radius)", boxShadow: "var(--shadow)" }}
      className={cn(
        "border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2",
        active
          ? "ring-2 ring-[var(--color-brand)]"
          : "hover:bg-[var(--color-surface-2)]",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
          {label}
        </span>
        {active ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand-strong)]">
            Filtered
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "font-display mt-2 block text-2xl font-semibold tabular-nums",
          STATE_VALUE_TONE[filter],
        )}
      >
        {count}
      </span>
      <span className="mt-1 block text-xs text-[var(--color-muted)]">{hint}</span>
    </button>
  );
}

function AllocatedCell({ invoice, muted }: { invoice: any; muted: boolean }) {
  const readiness = invoice.readiness;
  const currency = invoice.currency ?? "CAD";
  const variance = Number(readiness?.allocationVarianceCents ?? 0);
  const allocated = Number(readiness?.allocatedSubtotalCents ?? 0);
  let detail: React.ReactNode;
  if (readiness?.allocationRequired === false && allocated === 0) {
    detail = <span className="text-[var(--color-muted)]">Not required</span>;
  } else if (allocated === 0 && (invoice.allocations ?? []).length === 0) {
    detail = <span className={muted ? "" : "text-[var(--color-warn)]"}>Not assigned</span>;
  } else if (variance === 0) {
    detail = <span className={muted ? "" : "text-[var(--color-good)]"}>Fully assigned</span>;
  } else if (variance > 0) {
    detail = (
      <span className={muted ? "" : "text-[var(--color-warn)]"}>
        {money(variance, currency)} unassigned
      </span>
    );
  } else {
    detail = (
      <span className={muted ? "" : "text-[var(--color-warn)]"}>
        {money(Math.abs(variance), currency)} assigned over the subtotal
      </span>
    );
  }
  return (
    <>
      <div className={cn("font-medium tabular-nums", muted ? "text-[var(--color-muted)]" : "text-[var(--color-heading)]")}>
        {money(allocated, currency)}
      </div>
      <div className={cn("mt-0.5 text-[11px]", muted && "text-[var(--color-muted)]")}>{detail}</div>
    </>
  );
}

function MatchedCell({ invoice, muted }: { invoice: any; muted: boolean }) {
  const readiness = invoice.readiness;
  const currency = invoice.currency ?? "CAD";
  const matched = Number(readiness?.matchedPaidCents ?? 0);
  const remaining = Number(readiness?.remainingBalanceCents ?? 0);
  let detail: React.ReactNode;
  if (muted) {
    detail = <span className="text-[var(--color-muted)]">Excluded from payment</span>;
  } else if (readiness?.paymentState === "paid" && matched === 0) {
    detail = <span className="text-[var(--color-good)]">User confirmed paid</span>;
  } else if (readiness?.paymentState === "sent_pending") {
    detail = <span className="text-[var(--color-warn)]">Transfer sent · awaiting deposit</span>;
  } else if (matched > 0 && remaining === 0) {
    detail = <span className="text-[var(--color-good)]">Settled</span>;
  } else if (remaining < 0) {
    detail = (
      <span className="text-[var(--color-warn)]">
        {money(Math.abs(remaining), currency)} overpaid
      </span>
    );
  } else {
    detail = (
      <span className="text-[var(--color-muted)]">
        {money(remaining, currency)} remaining
      </span>
    );
  }
  return (
    <>
      <div className={cn("font-medium tabular-nums", muted ? "text-[var(--color-muted)]" : "text-[var(--color-heading)]")}>
        {money(matched, currency)}
      </div>
      <div className="mt-0.5 text-[11px]">{detail}</div>
    </>
  );
}

function PaymentCell({ invoice }: { invoice: any }) {
  const readiness = invoice.readiness;
  const state = (readiness?.paymentState ?? "unpaid") as InvoicePaymentState;
  return (
    <>
      <StatusText tone={invoicePaymentTone(state)}>
        {invoicePaymentLabel(state)}
      </StatusText>
      <div
        className="mt-0.5 max-w-56 text-[11px] leading-4 text-[var(--color-muted)]"
        title={readiness?.paymentReason ?? undefined}
      >
        {readiness?.paymentReason}
      </div>
    </>
  );
}

function ReviewCell({ invoice }: { invoice: any }) {
  const readiness = invoice.readiness;
  const state = (readiness?.reviewState ?? "not_required") as InvoiceReviewState;
  if (state === "not_required") {
    return (
      <>
        <span aria-label={invoiceReviewLabel(state)} className="text-[var(--color-muted)]">—</span>
        <div className="mt-0.5 max-w-48 text-[11px] leading-4 text-[var(--color-muted)]">
          {readiness?.reviewReason}
        </div>
      </>
    );
  }
  return (
    <>
      <StatusText tone={invoiceReviewTone(state)}>
        {invoiceReviewLabel(state)}
      </StatusText>
      <div
        className="mt-0.5 max-w-48 text-[11px] leading-4 text-[var(--color-muted)]"
        title={readiness?.reviewReason ?? undefined}
      >
        {readiness?.reviewReason}
      </div>
    </>
  );
}

function InvoiceDestinations({ invoice, muted }: { invoice: any; muted: boolean }) {
  const destinations = invoiceDestinations(invoice);
  if (!destinations.length) {
    return <span className="text-xs text-[var(--color-muted)]">Nothing to assign</span>;
  }
  return (
    <div className="space-y-1 text-xs">
      {destinations.map((destination) => (
        <div
          key={destination.key}
          className={cn(
            "min-w-56",
            muted ? "text-[var(--color-muted)]" : "text-[var(--color-text)]",
          )}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className={cn("min-w-0", destination.key !== "unassigned" && "font-medium")}>
              {destination.name}
            </span>
            <span className="shrink-0 tabular-nums text-[var(--color-muted)]">
              — {money(destination.subtotalCents, invoice.currency ?? "CAD")}
            </span>
          </div>
          <DestinationLabourPercentages
            destination={destination}
            currency={invoice.currency ?? "CAD"}
            muted={muted}
          />
        </div>
      ))}
    </div>
  );
}

function WorkCompleteCell({ invoice, muted }: { invoice: any; muted: boolean }) {
  const jobs = invoiceDestinations(invoice).filter(
    (destination) =>
      destination.key !== "company-expense" && destination.key !== "unassigned",
  );
  if (!jobs.length) {
    return (
      <>
        <span className="text-[var(--color-muted)]">—</span>
        <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
          No assigned job
        </div>
      </>
    );
  }
  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <div key={job.key} className="min-w-32">
          {jobs.length > 1 ? (
            <div className="mb-0.5 max-w-44 truncate text-[10px] text-[var(--color-muted)]" title={job.name}>
              {job.name}
            </div>
          ) : null}
          {job.productionMonth ? (
            <>
              <StatusText tone={muted ? "neutral" : "good"}>Work complete</StatusText>
              <div className="mt-0.5 text-[11px] font-medium text-[var(--color-muted)]">
                {fmtMonthYear(job.productionMonth)}
              </div>
            </>
          ) : (
            <>
              <StatusText tone={muted ? "neutral" : "warn"}>Not complete</StatusText>
              <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                No production month
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function LabourInvoiceReview({ invoices }: { invoices: any[] }) {
  const [paymentFilter, setPaymentFilter] = React.useState<InvoicePaymentState | "all">("all");
  const [reviewFilter, setReviewFilter] = React.useState<InvoiceReviewState | "all">("all");
  const [supplierFilter, setSupplierFilter] = React.useState<string>("all");
  const [search, setSearch] = React.useState("");
  const [includeHistorical, setIncludeHistorical] = React.useState(false);

  const historicalCount = React.useMemo(
    () => invoices.filter((invoice) => invoice.historical).length,
    [invoices],
  );
  const visibleInvoices = React.useMemo(
    () =>
      includeHistorical
        ? invoices
        : invoices.filter((invoice) => !invoice.historical),
    [includeHistorical, invoices],
  );

  const counts = React.useMemo(() => {
    const byState = { unpaid: 0, sent_pending: 0, paid: 0, void: 0, needs_review: 0 } as Record<SummaryFilter, number>;
    for (const invoice of visibleInvoices) {
      const paymentState = (invoice.readiness?.paymentState ?? "unpaid") as InvoicePaymentState;
      const reviewState = (invoice.readiness?.reviewState ?? "not_required") as InvoiceReviewState;
      byState[paymentState] += 1;
      if (reviewState === "needs_review") byState.needs_review += 1;
    }
    return byState;
  }, [visibleInvoices]);

  const suppliers = React.useMemo(
    () =>
      [...new Set(visibleInvoices.map(contactName))].sort((left, right) =>
        left.localeCompare(right, "en-CA"),
      ),
    [visibleInvoices],
  );

  const query = search.trim().toLocaleLowerCase("en-CA");
  const filtered = visibleInvoices.filter((invoice) => {
    const paymentState = (invoice.readiness?.paymentState ?? "unpaid") as InvoicePaymentState;
    const reviewState = (invoice.readiness?.reviewState ?? "not_required") as InvoiceReviewState;
    if (paymentFilter !== "all" && paymentState !== paymentFilter) return false;
    if (reviewFilter !== "all" && reviewState !== reviewFilter) return false;
    if (supplierFilter !== "all" && contactName(invoice) !== supplierFilter) return false;
    if (query) {
      const haystack = [
        invoice.invoice_number ?? "",
        contactName(invoice),
        ...jobNames(invoice),
      ]
        .join(" ")
        .toLocaleLowerCase("en-CA");
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const hasFilters = paymentFilter !== "all" || reviewFilter !== "all" || supplierFilter !== "all" || search !== "";
  const clearFilters = () => {
    setPaymentFilter("all");
    setReviewFilter("all");
    setSupplierFilter("all");
    setSearch("");
  };

  const stateHints: Record<SummaryFilter, string> = {
    unpaid: "payment still outstanding",
    sent_pending: "transfer sent, awaiting deposit",
    paid: "cleared by matched bank payment",
    void: "excluded from payment",
    needs_review: "paid invoice with another issue",
  };

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        {SUMMARY_FILTERS.map((filter) => (
          <SummaryCard
            key={filter}
            filter={filter}
            label={summaryLabel(filter)}
            count={counts[filter]}
            hint={stateHints[filter]}
            active={filter === "needs_review" ? reviewFilter === filter : paymentFilter === filter}
            onClick={() => {
              if (filter === "needs_review") {
                setPaymentFilter("all");
                setReviewFilter(reviewFilter === filter ? "all" : filter);
              } else {
                setReviewFilter("all");
                setPaymentFilter(paymentFilter === filter ? "all" : filter);
              }
            }}
          />
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--color-border)] px-4 py-3.5 md:flex-row md:items-center">
          <div className="flex-1">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search invoice, supplier, or job…"
              aria-label="Search invoices by invoice number, supplier, or job"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={paymentFilter}
              onChange={(event) =>
                setPaymentFilter(event.target.value as InvoicePaymentState | "all")
              }
              aria-label="Filter by payment status"
              className="min-w-36"
            >
              <option value="all">All payments</option>
              {(["unpaid", "sent_pending", "paid", "void"] as InvoicePaymentState[]).map((state) => (
                <option key={state} value={state}>
                  {invoicePaymentLabel(state)}
                </option>
              ))}
            </Select>
            <Select
              value={reviewFilter}
              onChange={(event) =>
                setReviewFilter(event.target.value as InvoiceReviewState | "all")
              }
              aria-label="Filter by review status"
              className="min-w-36"
            >
              <option value="all">All reviews</option>
              <option value="needs_review">Needs review</option>
              <option value="complete">Complete</option>
            </Select>
            <Select
              value={supplierFilter}
              onChange={(event) => setSupplierFilter(event.target.value)}
              aria-label="Filter by supplier"
              className="min-w-40 max-w-56"
            >
              <option value="all">All suppliers</option>
              {suppliers.map((supplier) => (
                <option key={supplier} value={supplier}>
                  {supplier}
                </option>
              ))}
            </Select>
            {historicalCount > 0 ? (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={includeHistorical}
                  onChange={(event) => setIncludeHistorical(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-brand)]"
                />
                Include historical ({historicalCount})
              </label>
            ) : null}
            <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!hasFilters}>
              Clear filters
            </Button>
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            {paymentFilter === "all" && reviewFilter === "all"
              ? "All contractor invoices"
              : [
                  paymentFilter === "all" ? null : invoicePaymentLabel(paymentFilter),
                  reviewFilter === "all" ? null : invoiceReviewLabel(reviewFilter),
                ].filter(Boolean).join(" · ")}
          </span>
          <span aria-live="polite" className="text-xs tabular-nums text-[var(--color-muted)]">
            {filtered.length} of {visibleInvoices.length} invoices
            {!includeHistorical && historicalCount > 0
              ? ` · ${historicalCount} historical hidden`
              : ""}
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState>
            {visibleInvoices.length === 0
              ? "No contractor invoices to review yet."
              : "No invoices match these filters."}
          </EmptyState>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1240px] text-left text-sm">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Invoice</th>
                    <th className="px-4 py-2.5 font-medium">Supplier</th>
                    <th className="px-4 py-2.5 font-medium">Where it belongs</th>
                    <th className="px-4 py-2.5 font-medium">Work complete</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total</th>
                    <th className="px-4 py-2.5 text-right font-medium">Assigned</th>
                    <th className="px-4 py-2.5 text-right font-medium">Matched</th>
                    <th className="px-4 py-2.5 font-medium">Payment</th>
                    <th className="px-4 py-2.5 font-medium">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {filtered.map((invoice) => {
                    const isVoid = invoice.readiness?.paymentState === "void";
                    return (
                      <tr key={invoice.id} className="align-top">
                        <td className="px-4 py-3.5">
                          <Link
                            href={`/invoices/${encodeURIComponent(invoice.id)}`}
                            aria-label={`Open invoice ${invoice.invoice_number}`}
                            className={cn(
                              "font-semibold underline decoration-1 underline-offset-4 transition hover:decoration-2 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2",
                              isVoid
                                ? "text-[var(--color-muted)]"
                                : "text-[var(--color-brand-strong)]",
                            )}
                          >
                            #{invoice.invoice_number}
                          </Link>
                          <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                            {fmtDate(invoice.issued_on)}
                          </div>
                        </td>
                        <td className={cn("px-4 py-3.5", isVoid && "text-[var(--color-muted)]")}>
                          {contactName(invoice)}
                        </td>
                        <td className="px-4 py-3.5">
                          <InvoiceDestinations invoice={invoice} muted={isVoid} />
                        </td>
                        <td className="px-4 py-3.5">
                          <WorkCompleteCell invoice={invoice} muted={isVoid} />
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3.5 text-right font-medium tabular-nums",
                            isVoid ? "text-[var(--color-muted)]" : "text-[var(--color-heading)]",
                          )}
                        >
                          {money(invoice.total_cents, invoice.currency ?? "CAD")}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <AllocatedCell invoice={invoice} muted={isVoid} />
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <MatchedCell invoice={invoice} muted={isVoid} />
                        </td>
                        <td className="px-4 py-3.5">
                          <PaymentCell invoice={invoice} />
                        </td>
                        <td className="px-4 py-3.5">
                          <ReviewCell invoice={invoice} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[var(--color-border)] md:hidden">
              {filtered.map((invoice) => {
                const isVoid = invoice.readiness?.paymentState === "void";
                return (
                  <div key={invoice.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/invoices/${encodeURIComponent(invoice.id)}`}
                          aria-label={`Open invoice ${invoice.invoice_number}`}
                          className={cn(
                            "font-semibold underline decoration-1 underline-offset-4",
                            isVoid
                              ? "text-[var(--color-muted)]"
                              : "text-[var(--color-brand-strong)]",
                          )}
                        >
                          #{invoice.invoice_number}
                        </Link>
                        <div className={cn("mt-0.5 truncate text-sm", isVoid ? "text-[var(--color-muted)]" : "text-[var(--color-text)]")}>
                          {contactName(invoice)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                          {fmtDate(invoice.issued_on)}
                        </div>
                      </div>
                      <div
                        className={cn(
                          "shrink-0 text-right font-semibold tabular-nums",
                          isVoid ? "text-[var(--color-muted)]" : "text-[var(--color-heading)]",
                        )}
                      >
                        {money(invoice.total_cents, invoice.currency ?? "CAD")}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--color-border)] pt-3 text-sm">
                      <div>
                        <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                          Assigned
                        </div>
                        <div className="mt-0.5">
                          <AllocatedCell invoice={invoice} muted={isVoid} />
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                          Matched
                        </div>
                        <div className="mt-0.5">
                          <MatchedCell invoice={invoice} muted={isVoid} />
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                        Where it belongs
                      </div>
                      <InvoiceDestinations invoice={invoice} muted={isVoid} />
                    </div>

                    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                        Work complete
                      </div>
                      <WorkCompleteCell invoice={invoice} muted={isVoid} />
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--color-border)] pt-3">
                      <div>
                        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                          Payment
                        </div>
                        <PaymentCell invoice={invoice} />
                      </div>
                      <div>
                        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                          Review
                        </div>
                        <ReviewCell invoice={invoice} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
