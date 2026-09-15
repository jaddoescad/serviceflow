"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input } from "@/components/ui";
import { fmtMoney, fmtHours } from "@/lib/format";
import { setJobAmount } from "@/lib/actions/budgets";
import {
  LABOUR_ALERT_PERCENT,
  budgetStatus,
} from "@/lib/metrics";
import type { BudgetStatus, ProjectRollup } from "@/lib/metrics";
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
}: {
  percent: number | null;
  status: BudgetStatus;
}) {
  if (percent == null) {
    return <span className="text-xs text-[var(--color-muted)]">—</span>;
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
  totals, total, currentPage, query,
  canManage,
}: {
  rows: ProjectTableRow[];
  totals: { overCount: number; readyToCloseCount: number };
  total: number; currentPage: number; query: string;
  canManage: boolean;
}) {
  const [search, setSearch] = useState(query);
  const [budgetFor, setBudgetFor] = useState<ProjectRollup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const router = useRouter();
  const previousQuery = useRef(query);
  useEffect(() => {
    const previous = previousQuery.current;
    previousQuery.current = query;
    setSearch(value => value === previous ? query : value);
  }, [query]);
  function navigate(page: number, value: string) {
    const params = new URLSearchParams();
    if (value) params.set("q", value);
    if (page > 1) params.set("page", String(page));
    startTransition(() => router.replace(`/jobs${params.size ? `?${params}` : ""}`, { scroll: false }));
  }
  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => navigate(1, search), 300);
    return () => clearTimeout(timer);
  }, [search, query]);
  const filtered = rows;
  const totalPages = Math.max(1, Math.ceil(total / 50));
  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action failed");
      else { done?.(); router.refresh(); }
    });
  }

  return (
    <>
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
                      {r.labourExcluded ? "—" : <>{fmtMoney(painterBudget(r))} <span className="text-xs text-[var(--color-muted)]">({r.budgetedHours == null ? "hours not set" : fmtHours(r.budgetedHours)})</span></>}
                    </td>
                    <td
                      className="px-2.5 py-2.5 text-right font-medium tabular-nums"
                      title={
                        r.unpricedHours > 0
                          ? `${r.unpricedHours.toFixed(1)} clocked hours have no pay rate and are excluded`
                          : "Priced clocked wages before any invoice override"
                      }
                    >
                      {r.labourExcluded ? "—" : <>{fmtMoney(r.clockedWageCost)} <span className="text-xs text-[var(--color-muted)]">({fmtHours(r.clockedHours)})</span></>}
                    </td>
                    <td className="px-2.5 py-2.5">
                      <UsageBar
                        percent={r.labourExcluded ? null : labourShare(r.amountBeforeTax, r.clockedWageCost)}
                        status={budgetStatus(r.labourExcluded ? null : labourShare(r.amountBeforeTax, r.clockedWageCost))}
                      />
                    </td>



                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 ? <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-3">
          <span className="text-xs text-[var(--color-muted)]">{(currentPage - 1) * 50 + 1}–{Math.min(currentPage * 50, total)} of {total}</span>
          <div className="flex items-center gap-2"><Button size="sm" variant="subtle" disabled={pending || currentPage <= 1} onClick={() => navigate(currentPage - 1, query)}>Previous</Button><span className="text-xs">Page {currentPage} of {totalPages}</span><Button size="sm" variant="subtle" disabled={pending || currentPage >= totalPages} onClick={() => navigate(currentPage + 1, query)}>Next</Button></div>
        </div> : null}
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
