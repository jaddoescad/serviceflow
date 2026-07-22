"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Card, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui";
import { Kpi } from "@/components/kpi";
import { fmtMoney, fmtDate } from "@/lib/format";
import { setJobAmount } from "@/lib/actions/budgets";
import { LABOUR_ALERT_PERCENT } from "@/lib/metrics";
import type { BudgetStatus, ProjectRollup } from "@/lib/metrics";
import { AmountDialog } from "@/components/project-detail";

function UsageBar({ percent, status }: { percent: number | null; status: BudgetStatus }) {
  if (percent == null) return <span className="text-xs text-[var(--color-muted)]">—</span>;
  const color = status === "over" ? "var(--color-bad)" : status === "near" ? "var(--color-warn)" : "var(--color-good)";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, (percent / LABOUR_ALERT_PERCENT) * 100)}%`, background: color }}
        />
      </div>
      <span className="whitespace-nowrap text-xs font-medium tabular-nums text-[var(--color-text)]">{percent.toFixed(1)}%</span>
    </div>
  );
}

export function ProjectsTable({
  rows,
  canManage,
}: {
  rows: ProjectRollup[];
  canManage: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [budgetFor, setBudgetFor] = useState<ProjectRollup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (filter === "budgeted" && r.amountBeforeTax == null) return false;
        if (filter === "over" && r.status !== "over") return false;
        if (filter === "nobudget" && r.amountBeforeTax != null) return false;
        if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [rows, search, filter],
  );

  const totals = useMemo(() => {
    let jobValue = 0;
    let wages = 0;
    let over = 0;
    for (const r of rows) {
      if (r.amountBeforeTax != null && r.wageCost > 0) {
        jobValue += r.amountBeforeTax;
        wages += r.wageCost;
        if (r.status === "over") over += 1;
      }
    }
    return { jobValue, wages, over, pct: jobValue > 0 ? (wages / jobValue) * 100 : null };
  }, [rows]);

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
        <Kpi label="Job value" value={fmtMoney(totals.jobValue)} hint="before HST" />
        <Kpi label="Painter budget" value={fmtMoney(totals.wages)} hint="timesheets + fixed invoices" />
        <Kpi
          label="Labour share"
          value={totals.pct != null ? `${totals.pct.toFixed(1)}%` : "—"}
          tone={totals.pct == null ? "neutral" : totals.pct >= LABOUR_ALERT_PERCENT ? "bad" : "good"}
          hint="green below 40%"
        />
        <Kpi label="40% or higher" value={totals.over} tone={totals.over ? "bad" : "good"} hint="jobs" />
      </div>

      <Card>
        <CardHeader title="Jobs & labour" subtitle="Painter budget against 35–38% of the entered job amount" />
        <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-border)] p-4">
          <Field label="Search">
            <Input placeholder="Job name…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
          </Field>
          <Field label="Filter">
            <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All jobs</option>
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  <th className="px-4 py-2.5 font-medium">Job</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount (before HST)</th>
                  <th className="px-4 py-2.5 text-right font-medium">Painter budget</th>
                  <th className="px-4 py-2.5 font-medium">Used by painters</th>
                  <th className="px-4 py-2.5 font-medium">Last active ↓</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.projectId}
                    className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="max-w-[240px] px-4 py-2.5">
                      <Link
                        href={`/projects/${encodeURIComponent(r.projectId)}`}
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
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-muted)]">
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
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {r.labourExcluded ? "—" : fmtMoney(r.wageCost)}
                    </td>
                    <td className="px-4 py-2.5">
                      <UsageBar percent={r.wageSharePercent} status={r.status} />
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-muted)]">{fmtDate(r.lastActivity)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/projects/${encodeURIComponent(r.projectId)}/calculator?name=${encodeURIComponent(r.name)}`}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                        >
                          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
                            <rect x="4" y="2.75" width="12" height="14.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M6.75 5.5h6.5v2.25h-6.5z" stroke="currentColor" strokeWidth="1.25" />
                            <path
                              d="M7 10.5h.01M10 10.5h.01M13 10.5h.01M7 13.5h.01M10 13.5h.01M13 13.5h.01"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                          </svg>
                          Calculator
                        </Link>
                      </div>
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
