"use client";

import * as React from "react";
import Link from "next/link";
import { Button, Card, EmptyState, Input, Select, StatusText, cn } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import {
  invoiceReadinessLabel,
  invoiceReadinessTone,
  type InvoiceReadinessState,
} from "@/lib/invoice-readiness";

const REVIEW_STATES: InvoiceReadinessState[] = [
  "needs_review",
  "ready_to_pay",
  "paid",
  "void",
];

const STATE_VALUE_TONE: Record<InvoiceReadinessState, string> = {
  needs_review: "text-[var(--color-warn)]",
  ready_to_pay: "text-[var(--color-brand-strong)]",
  paid: "text-[var(--color-good)]",
  void: "text-[var(--color-muted)]",
};

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

function jobNames(invoice: any): string[] {
  const names = (invoice.allocations ?? [])
    .map((allocation: any) => {
      const job = Array.isArray(allocation.job) ? allocation.job[0] : allocation.job;
      return job?.name ?? allocation.job_id ?? null;
    })
    .filter(Boolean) as string[];
  return [...new Set(names)];
}

function StateCard({
  state,
  count,
  hint,
  active,
  onClick,
}: {
  state: InvoiceReadinessState;
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
          {invoiceReadinessLabel(state)}
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
          STATE_VALUE_TONE[state],
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
  if (allocated === 0 && (invoice.allocations ?? []).length === 0) {
    detail = <span className={muted ? "" : "text-[var(--color-warn)]"}>Not allocated</span>;
  } else if (variance === 0) {
    detail = <span className={muted ? "" : "text-[var(--color-good)]"}>Matches subtotal</span>;
  } else if (variance > 0) {
    detail = (
      <span className={muted ? "" : "text-[var(--color-warn)]"}>
        {money(variance, currency)} unallocated
      </span>
    );
  } else {
    detail = (
      <span className={muted ? "" : "text-[var(--color-warn)]"}>
        {money(Math.abs(variance), currency)} overallocated
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

function StateCell({ invoice }: { invoice: any }) {
  const readiness = invoice.readiness;
  const state = (readiness?.state ?? "needs_review") as InvoiceReadinessState;
  return (
    <>
      <StatusText tone={invoiceReadinessTone(state)}>
        {invoiceReadinessLabel(state)}
      </StatusText>
      <div
        className="mt-0.5 max-w-56 text-[11px] leading-4 text-[var(--color-muted)]"
        title={readiness?.reason ?? undefined}
      >
        {readiness?.reason}
      </div>
    </>
  );
}

function InvoiceJobs({ invoice, muted }: { invoice: any; muted: boolean }) {
  const names = jobNames(invoice);
  if (!names.length) {
    return <span className="text-xs text-[var(--color-muted)]">No job allocation</span>;
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
      {names.slice(0, 2).map((name) => (
        <span
          key={name}
          className={cn(
            "font-medium",
            muted ? "text-[var(--color-muted)]" : "text-[var(--color-text)]",
          )}
        >
          {name}
        </span>
      ))}
      {names.length > 2 ? (
        <span className="text-[var(--color-muted)]">+{names.length - 2} more</span>
      ) : null}
    </div>
  );
}

export function LabourInvoiceReview({ invoices }: { invoices: any[] }) {
  const [stateFilter, setStateFilter] = React.useState<InvoiceReadinessState | "all">("all");
  const [supplierFilter, setSupplierFilter] = React.useState<string>("all");
  const [search, setSearch] = React.useState("");

  const counts = React.useMemo(() => {
    const byState = { needs_review: 0, ready_to_pay: 0, paid: 0, void: 0 } as Record<
      InvoiceReadinessState,
      number
    >;
    for (const invoice of invoices) {
      const state = (invoice.readiness?.state ?? "needs_review") as InvoiceReadinessState;
      byState[state] += 1;
    }
    return byState;
  }, [invoices]);

  const suppliers = React.useMemo(
    () =>
      [...new Set(invoices.map(contactName))].sort((left, right) =>
        left.localeCompare(right, "en-CA"),
      ),
    [invoices],
  );

  const query = search.trim().toLocaleLowerCase("en-CA");
  const filtered = invoices.filter((invoice) => {
    const state = (invoice.readiness?.state ?? "needs_review") as InvoiceReadinessState;
    if (stateFilter !== "all" && state !== stateFilter) return false;
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

  const hasFilters = stateFilter !== "all" || supplierFilter !== "all" || search !== "";
  const clearFilters = () => {
    setStateFilter("all");
    setSupplierFilter("all");
    setSearch("");
  };

  const stateHints: Record<InvoiceReadinessState, string> = {
    needs_review: "source, totals, or allocation issue",
    ready_to_pay: "checks passed · payment outstanding",
    paid: "cleared by matched bank payment",
    void: "excluded from payment",
  };

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {REVIEW_STATES.map((state) => (
          <StateCard
            key={state}
            state={state}
            count={counts[state]}
            hint={stateHints[state]}
            active={stateFilter === state}
            onClick={() => setStateFilter(stateFilter === state ? "all" : state)}
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
              value={stateFilter}
              onChange={(event) =>
                setStateFilter(event.target.value as InvoiceReadinessState | "all")
              }
              aria-label="Filter by state"
              className="min-w-36"
            >
              <option value="all">All states</option>
              {REVIEW_STATES.map((state) => (
                <option key={state} value={state}>
                  {invoiceReadinessLabel(state)}
                </option>
              ))}
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
            <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!hasFilters}>
              Clear filters
            </Button>
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            {stateFilter === "all" ? "All labour invoices" : invoiceReadinessLabel(stateFilter)}
          </span>
          <span aria-live="polite" className="text-xs tabular-nums text-[var(--color-muted)]">
            {filtered.length} of {invoices.length} invoices
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState>
            {invoices.length === 0
              ? "No labour invoices to review yet."
              : "No invoices match these filters."}
          </EmptyState>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Invoice</th>
                    <th className="px-4 py-2.5 font-medium">Supplier</th>
                    <th className="px-4 py-2.5 font-medium">Jobs</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total</th>
                    <th className="px-4 py-2.5 text-right font-medium">Allocated</th>
                    <th className="px-4 py-2.5 text-right font-medium">Matched</th>
                    <th className="px-4 py-2.5 font-medium">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {filtered.map((invoice) => {
                    const isVoid = invoice.readiness?.state === "void";
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
                          <InvoiceJobs invoice={invoice} muted={isVoid} />
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
                          <StateCell invoice={invoice} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[var(--color-border)] md:hidden">
              {filtered.map((invoice) => {
                const isVoid = invoice.readiness?.state === "void";
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
                          Allocated
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
                        Jobs
                      </div>
                      <InvoiceJobs invoice={invoice} muted={isVoid} />
                    </div>

                    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                      <StateCell invoice={invoice} />
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
