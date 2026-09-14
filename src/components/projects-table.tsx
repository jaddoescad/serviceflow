"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Badge, Card, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui";
import { Kpi } from "@/components/kpi";
import { fmtMoney } from "@/lib/format";
import { setJobAmount } from "@/lib/actions/budgets";
import {
  LABOUR_ALERT_PERCENT,
  budgetStatus,
  readyToCloseLabour,
  summarizeLabour,
} from "@/lib/metrics";
import type { BudgetStatus, ProjectRollup } from "@/lib/metrics";
import { compareJobsTableRows } from "@/lib/project-sort";
import { AmountDialog } from "@/components/job-amount-dialog";

type ProjectTableRow = ProjectRollup;


function painterBudget(row: ProjectTableRow): number | null {
  return row.amountBeforeTax == null
    ? null
    : row.amountBeforeTax * (LABOUR_ALERT_PERCENT / 100);
}

function UsageBar({
  percent,
  status,
  label,
  amount,
}: {
  percent: number | null;
  status: BudgetStatus;
  label: string;
  amount: number;
}) {
  if (percent == null) {
    return amount > 0 ? (
      <div>
        <span className="text-xs text-[var(--color-muted)]">—</span>
        <div className="mt-0.5 text-[10px] text-[var(--color-muted)]">
          {label} · {fmtMoney(amount)}
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
        {label} · {fmtMoney(amount)}
      </div>
    </div>
  );
}

function labourShare(amountBeforeTax: number | null, cost: number): number | null {
  return amountBeforeTax && amountBeforeTax > 0
    ? (cost / amountBeforeTax) * 100
    : null;
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
    return matches.sort(compareJobsTableRows);
  }, [rows, search, filter, now]);

  const visibleAmountSummary = useMemo(() => {
    const jobsWithAmount = filtered.filter(
      (row) => row.amountBeforeTax != null,
    );
    return {
      jobCount: filtered.length,
      amountCount: jobsWithAmount.length,
      missingAmountCount: filtered.length - jobsWithAmount.length,
      totalBeforeHst:
        jobsWithAmount.length > 0
          ? jobsWithAmount.reduce(
              (total, row) => total + Number(row.amountBeforeTax),
              0,
            )
          : null,
    };
  }, [filtered]);

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
          hint="costed completions · clocked wages"
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
          subtitle="Compare clocked wages with each job’s labour budget"
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

        <div
          className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
          aria-live="polite"
          aria-atomic="true"
        >
          <div>
            <div className="text-xs font-medium text-[var(--color-muted)]">
              Total job value before HST
            </div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums text-[var(--color-heading)]">
              {fmtMoney(visibleAmountSummary.totalBeforeHst)}
            </div>
          </div>
          <div className="text-right text-xs text-[var(--color-muted)]">
            <div className="font-medium text-[var(--color-text)]">
              {visibleAmountSummary.jobCount}{" "}
              {visibleAmountSummary.jobCount === 1 ? "job" : "jobs"}
            </div>
            <div className="mt-0.5">
              {visibleAmountSummary.missingAmountCount > 0
                ? `${visibleAmountSummary.amountCount} included · ${visibleAmountSummary.missingAmountCount} missing ${visibleAmountSummary.missingAmountCount === 1 ? "amount" : "amounts"} excluded`
                : visibleAmountSummary.jobCount > 0
                  ? "All visible jobs have amounts"
                  : "No visible jobs"}
            </div>
          </div>
        </div>

        {error ? (
          <div className="border-b border-[var(--color-border)] bg-[var(--color-bad-soft)] px-4 py-2 text-sm text-[var(--color-bad)]">
            {error}
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <EmptyState>
            No jobs match the current filters.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] table-fixed text-[13px]">
              <colgroup><col className="w-[28%]" /><col className="w-[18%]" /><col className="w-[18%]" /><col className="w-[18%]" /><col className="w-[18%]" /></colgroup>
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
                  <th className="px-2.5 py-2.5 font-medium">Hourly usage</th>



                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.projectId}
                    className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="px-2.5 py-2.5">
                      <Link
                        href={`/jobs/${encodeURIComponent(r.projectId)}`}
                        prefetch={false}
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
                    <td className="px-2.5 py-2.5">
                      <UsageBar
                        percent={r.labourExcluded ? null : labourShare(r.amountBeforeTax, r.clockedWageCost)}
                        status={budgetStatus(r.labourExcluded ? null : labourShare(r.amountBeforeTax, r.clockedWageCost))}
                        label="Clocked hours"
                        amount={r.clockedWageCost}
                      />
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
