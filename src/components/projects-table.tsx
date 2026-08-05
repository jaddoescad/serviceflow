"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Badge, Card, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui";
import { Kpi } from "@/components/kpi";
import { fmtCurrencyTotals, fmtMoney, fmtDate } from "@/lib/format";
import { setJobAmount } from "@/lib/actions/budgets";
import {
  LABOUR_ALERT_PERCENT,
  LABOUR_MAX_PERCENT,
  LABOUR_MIN_PERCENT,
  readyToCloseLabour,
  summarizeLabour,
} from "@/lib/metrics";
import type { BudgetStatus, ProjectRollup } from "@/lib/metrics";
import type { ProjectLabourInvoiceSummary } from "@/lib/invoice-queries";
import type { ProjectMaterialSummary } from "@/lib/materials";
import { AmountDialog } from "@/components/project-detail";

type ProjectTableRow = ProjectRollup & {
  labourInvoices: ProjectLabourInvoiceSummary;
  materials: ProjectMaterialSummary;
};

function painterBudget(row: ProjectTableRow): number | null {
  return row.amountBeforeTax == null
    ? null
    : row.amountBeforeTax * (LABOUR_ALERT_PERCENT / 100);
}

function BudgetLeft({
  amountBeforeTax,
  used,
}: {
  amountBeforeTax: number | null;
  used: number;
}) {
  if (amountBeforeTax == null) {
    return <span className="text-xs text-[var(--color-muted)]">—</span>;
  }

  const comparisons = [
    LABOUR_MIN_PERCENT,
    LABOUR_MAX_PERCENT,
    LABOUR_ALERT_PERCENT,
  ].map((percent) => ({
    percent,
    remaining: amountBeforeTax * (percent / 100) - used,
  }));

  return (
    <div
      className="ml-auto inline-flex items-baseline justify-end whitespace-nowrap text-[11px]"
      title={`${fmtMoney(used)} chosen painter cost subtracted from each labour allowance`}
    >
      {comparisons.map(({ percent, remaining }, index) => (
        <span
          key={percent}
          className="inline-flex items-baseline"
        >
          {index > 0 ? (
            <span className="mx-1 font-normal text-[var(--color-muted)]">/</span>
          ) : null}
          <span
            className={`font-medium ${
              remaining < 0
                ? "text-[var(--color-bad)]"
                : "text-[var(--color-good)]"
            }`}
          >
            {fmtMoney(remaining)}
          </span>
        </span>
      ))}
    </div>
  );
}

function UsageBar({
  percent,
  status,
  source,
  amount,
}: {
  percent: number | null;
  status: BudgetStatus;
  source: ProjectRollup["labourCostSource"];
  amount: number;
}) {
  const sourceLabel =
    source === "invoices" ? "Invoices" : "Clocked hours";
  if (percent == null) {
    return amount > 0 ? (
      <div>
        <span className="text-xs text-[var(--color-muted)]">—</span>
        <div className="mt-0.5 text-[10px] text-[var(--color-muted)]">
          {sourceLabel} · {fmtMoney(amount)} chosen
        </div>
      </div>
    ) : (
      <span className="text-xs text-[var(--color-muted)]">—</span>
    );
  }
  const color = status === "over" ? "var(--color-bad)" : status === "near" ? "var(--color-warn)" : "var(--color-good)";
  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--color-surface-2)] xl:w-20">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, (percent / LABOUR_ALERT_PERCENT) * 100)}%`, background: color }}
          />
        </div>
        <span className="whitespace-nowrap text-xs font-medium tabular-nums text-[var(--color-text)]">{percent.toFixed(1)}%</span>
      </div>
      <div className="mt-0.5 whitespace-nowrap text-[10px] text-[var(--color-muted)]">
        {sourceLabel} · {fmtMoney(amount)} chosen
      </div>
    </div>
  );
}

function MaterialShareBar({
  amountBeforeTax,
  materialCost,
  lineCount,
}: {
  amountBeforeTax: number | null;
  materialCost: number;
  lineCount: number;
}) {
  const percent =
    amountBeforeTax && amountBeforeTax > 0 && materialCost > 0
      ? (materialCost / amountBeforeTax) * 100
      : null;
  if (percent == null) {
    return <span className="text-xs text-[var(--color-muted)]">—</span>;
  }

  return (
    <div
      title={`${fmtMoney(materialCost)} allocated materials ÷ ${fmtMoney(amountBeforeTax)} job amount before HST`}
    >
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--color-surface-2)] xl:w-20">
          <div
            className="h-full rounded-full bg-[var(--color-brand)]"
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
        <span className="whitespace-nowrap text-xs font-medium tabular-nums text-[var(--color-text)]">
          {percent.toFixed(1)}%
        </span>
      </div>
      <div className="mt-0.5 whitespace-nowrap text-[10px] text-[var(--color-muted)]">
        {lineCount} allocated {lineCount === 1 ? "line" : "lines"}
      </div>
    </div>
  );
}

function JobStatus({ row }: { row: ProjectTableRow }) {
  return row.labourClosedAt ? (
    <Badge tone="good">Completed</Badge>
  ) : (
    <Badge tone="neutral">Not completed</Badge>
  );
}

function activityTimestamp(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function recentActivity(row: ProjectTableRow): {
  value: string | null;
  source: "Invoice" | "Clock-in" | null;
  timestamp: number;
} {
  const invoiceValue = row.labourInvoices.latestInvoiceDate
    ? `${row.labourInvoices.latestInvoiceDate}T12:00:00`
    : null;
  const invoiceTimestamp = activityTimestamp(invoiceValue);
  const clockInTimestamp = activityTimestamp(row.lastClockIn);

  if (invoiceTimestamp >= clockInTimestamp && invoiceTimestamp > 0) {
    return {
      value: invoiceValue,
      source: "Invoice",
      timestamp: invoiceTimestamp,
    };
  }
  if (clockInTimestamp > 0) {
    return {
      value: row.lastClockIn,
      source: "Clock-in",
      timestamp: clockInTimestamp,
    };
  }
  return { value: null, source: null, timestamp: 0 };
}

export function ProjectsTable({
  rows,
  now,
  canManage,
}: {
  rows: ProjectTableRow[];
  now: number;
  canManage: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [budgetFor, setBudgetFor] = useState<ProjectRollup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const matches = rows.filter((r) => {
        if (filter === "budgeted" && r.amountBeforeTax == null) return false;
        if (filter === "over" && r.status !== "over") return false;
        if (filter === "nobudget" && r.amountBeforeTax != null) return false;
        if (filter === "settled" && !r.labourClosedAt) return false;
        if (filter === "inflight" && r.labourClosedAt) return false;
        if (filter === "toclose" && !readyToCloseLabour(r, now)) return false;
        if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      });
    return matches
      .map((row) => ({ row, activity: recentActivity(row) }))
      .sort(
        (left, right) =>
          right.activity.timestamp - left.activity.timestamp ||
          left.row.name.localeCompare(right.row.name, "en-CA"),
    );
  }, [rows, search, filter, now]);

  // Only settled jobs produce a headline percentage. In-flight jobs carry a full
  // contract value against a part-spent labour cost, so averaging them in would
  // understate labour and flatter an unfinished book.
  const totals = useMemo(() => summarizeLabour(rows, now), [rows, now]);
  const completedCount = rows.filter((row) => Boolean(row.labourClosedAt)).length;
  const completedWithoutLabourCount = Math.max(
    0,
    completedCount - totals.settled.count,
  );
  const notCompletedCount = rows.filter(
    (row) => row.amountBeforeTax != null && !row.labourClosedAt,
  ).length;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action failed");
      else done?.();
    });
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="Job value"
          value={fmtMoney(totals.settled.jobValue)}
          hint={`${totals.settled.count} costed completions · before HST`}
        />
        <Kpi
          label="Painter cost"
          value={fmtMoney(totals.settled.labourCost)}
          hint="costed completions · invoices first, then timesheets"
        />
        <Kpi
          label="Labour share"
          value={totals.settled.sharePercent != null ? `${totals.settled.sharePercent.toFixed(1)}%` : "—"}
          tone={
            totals.settled.sharePercent == null
              ? "neutral"
              : totals.settled.sharePercent >= LABOUR_ALERT_PERCENT
                ? "bad"
                : "good"
          }
          hint={totals.settled.sharePercent != null ? "costed completed jobs · green below 40%" : "complete a finished job"}
        />
        <Kpi
          label="Completed"
          value={completedCount}
          tone="neutral"
          hint={
            completedWithoutLabourCount > 0
              ? `${completedWithoutLabourCount} need labour cost · ${notCompletedCount} not completed`
              : `${notCompletedCount} not completed`
          }
        />
      </div>

      <Card>
        <CardHeader
          title="Jobs & costs"
          subtitle="Labour uses clocked wages or allocated invoices; materials use allocated supplier-invoice lines before HST"
          right={
            <div className="flex flex-wrap gap-2">
              {totals.readyToCloseCount ? (
                <Badge tone="warn">{totals.readyToCloseCount} ready to complete</Badge>
              ) : null}
              <Badge tone={totals.overCount ? "bad" : "good"}>
                {totals.overCount ? `${totals.overCount} at 40% or higher` : "all below 40%"}
              </Badge>
            </div>
          }
        />
        <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-border)] p-4">
          <Field label="Search">
            <Input placeholder="Job name…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
          </Field>
          <Field label="Filter">
            <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All jobs</option>
              <option value="settled">Completed</option>
              <option value="inflight">Not completed</option>
              <option value="toclose">Ready to complete</option>
              <option value="budgeted">Has amount</option>
              <option value="over">40% or higher</option>
              <option value="nobudget">No amount set</option>
            </Select>
          </Field>
        </div>

        {error ? (
          <div className="border-b border-[var(--color-border)] bg-[var(--color-bad-soft)] px-4 py-2 text-sm text-[var(--color-bad)]">
            {error}
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <EmptyState>No jobs match.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] table-fixed text-[13px]">
              <colgroup>
                <col className="w-[14%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[9%]" />
                <col className="w-[7%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[9%]" />
                <col className="w-[7%]" />
                <col className="w-[7%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  <th className="px-2.5 py-2.5 font-medium">Job</th>
                  <th className="px-2.5 py-2.5 text-right font-medium">Amount (before HST)</th>
                  <th className="px-2.5 py-2.5 text-right font-medium">Painter budget (40%)</th>
                  <th
                    className="px-2.5 py-2.5 text-right font-medium"
                    title="Dollar cost of priced clocked hours"
                  >
                    Clocked hours ($)
                  </th>
                  <th className="px-2.5 py-2.5 text-right font-medium">
                    Labour invoices (pre-tax)
                  </th>
                  <th className="px-2.5 py-2.5 font-medium">Invoices</th>
                  <th className="px-2.5 py-2.5 font-medium">Used by painters</th>
                  <th className="px-2.5 py-2.5 text-right font-medium">
                    Materials (pre-tax)
                  </th>
                  <th className="px-2.5 py-2.5 font-medium">Material share</th>
                  <th className="px-2.5 py-2.5 font-medium">Recent activity ↓</th>
                  <th
                    className="px-2.5 py-2.5 text-right font-medium"
                    title="Amount remaining after the chosen painter cost at 35%, 37%, and 40% of the pre-tax job amount"
                  >
                    Budget left 35/37/40
                  </th>
                  <th className="px-2.5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ row: r, activity }) => (
                  <tr
                    key={r.projectId}
                    className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="px-2.5 py-2.5">
                      <Link
                        href={`/jobs/${encodeURIComponent(r.projectId)}`}
                        className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
                        aria-label={`View details for ${r.name}`}
                      >
                        <div className="truncate font-medium text-[var(--color-heading)] underline decoration-transparent underline-offset-4 transition-colors hover:text-[var(--color-brand-strong)] hover:decoration-current">
                          {r.name}
                        </div>
                        {r.address ? (
                          <div className="truncate text-xs text-[var(--color-muted)]">{r.address}</div>
                        ) : null}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5 text-right tabular-nums text-[var(--color-muted)]">
                      <div className="flex items-center justify-end gap-1.5">
                        <span>{fmtMoney(r.amountBeforeTax)}</span>
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() => setBudgetFor(r)}
                            disabled={pending}
                            aria-label={`Edit amount for ${r.name}`}
                            title="Edit amount"
                            className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
                              <path
                                d="M13.75 3.75a1.768 1.768 0 0 1 2.5 2.5l-8.5 8.5-3.25.75.75-3.25 8.5-8.5Z"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2.5 py-2.5 text-right font-medium tabular-nums">
                      {r.labourExcluded ? "—" : fmtMoney(painterBudget(r))}
                    </td>
                    <td
                      className="px-2.5 py-2.5 text-right font-medium tabular-nums"
                      title={
                        r.unpricedHours > 0
                          ? `${r.unpricedHours.toFixed(1)} clocked hours have no pay rate and are excluded`
                          : "Priced clocked wages before any invoice override"
                      }
                    >
                      {r.labourExcluded ? "—" : fmtMoney(r.clockedWageCost)}
                    </td>
                    <td
                      className="whitespace-nowrap px-2.5 py-2.5 text-right font-medium tabular-nums"
                      title="Pre-tax job cost from current invoice-entry allocations."
                    >
                      {fmtCurrencyTotals(r.labourInvoices.totals)}
                      {r.labourInvoices.needsReview ? (
                        <div className="text-[10px] font-normal text-[var(--color-warn)]">
                          Entry or settlement needs review
                        </div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5">
                      {r.labourInvoices.invoiceCount > 0 ? (
                        <>
                          <Link
                            href={`/jobs/${encodeURIComponent(r.projectId)}/invoices`}
                            className="font-medium text-[var(--color-brand-strong)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
                            aria-label={`View ${r.labourInvoices.invoiceCount} labour ${
                              r.labourInvoices.invoiceCount === 1
                                ? "invoice"
                                : "invoices"
                            } for ${r.name}`}
                          >
                            {r.labourInvoices.invoiceCount === 1
                              ? "View invoice"
                              : `View ${r.labourInvoices.invoiceCount} invoices`}
                          </Link>
                          {r.labourInvoices.hasDuplicateVersions ? (
                            <div className="text-[10px] text-[var(--color-muted)]">
                              {r.labourInvoices.linkedFileCount} linked files
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2.5">
                      <UsageBar
                        percent={r.wageSharePercent}
                        status={r.status}
                        source={r.labourCostSource}
                        amount={r.wageCost}
                      />
                    </td>
                    <td
                      className="whitespace-nowrap px-2.5 py-2.5 text-right font-medium tabular-nums"
                      title="Material invoice lines allocated to this job before HST"
                    >
                      {r.materials.amountBeforeTax > 0
                        ? fmtMoney(r.materials.amountBeforeTax)
                        : "—"}
                    </td>
                    <td className="px-2.5 py-2.5">
                      <MaterialShareBar
                        amountBeforeTax={r.amountBeforeTax}
                        materialCost={r.materials.amountBeforeTax}
                        lineCount={r.materials.lineCount}
                      />
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5 text-[var(--color-muted)]">
                      <div>{fmtDate(activity.value)}</div>
                      {activity.source ? (
                        <div className="text-[10px]">{activity.source}</div>
                      ) : null}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      <BudgetLeft
                        amountBeforeTax={r.labourExcluded ? null : r.amountBeforeTax}
                        used={r.wageCost}
                      />
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5">
                      <JobStatus row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {budgetFor ? (
        <AmountDialog
          project={budgetFor}
          pending={pending}
          onClose={() => setBudgetFor(null)}
          onSave={(input) => run(() => setJobAmount(input), () => setBudgetFor(null))}
        />
      ) : null}
    </>
  );
}
