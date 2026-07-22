"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui";
import { Kpi } from "@/components/kpi";
import { fmtHours, fmtMoney, fmtDate, fmtTime, initials } from "@/lib/format";
import { setJobAmount } from "@/lib/actions/budgets";
import { amountBeforeTax, LABOUR_ALERT_PERCENT, LABOUR_MAX_PERCENT, LABOUR_MIN_PERCENT } from "@/lib/metrics";
import type { BudgetStatus, ProjectDetail, ProjectRollup, ProjectTaskProgress } from "@/lib/metrics";

const statusTone: Record<BudgetStatus, "good" | "warn" | "bad" | "neutral"> = {
  under: "good",
  near: "warn",
  over: "bad",
  none: "neutral",
};

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
  detailsByProject,
  taskProgressByProject,
  canManage,
}: {
  rows: ProjectRollup[];
  detailsByProject: Record<string, ProjectDetail>;
  taskProgressByProject: Record<string, ProjectTaskProgress[]>;
  canManage: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [budgetFor, setBudgetFor] = useState<ProjectRollup | null>(null);
  const [detailsFor, setDetailsFor] = useState<ProjectRollup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (filter === "budgeted" && r.amountIncludingTax == null) return false;
        if (filter === "over" && r.status !== "over") return false;
        if (filter === "nobudget" && r.amountIncludingTax != null) return false;
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
        <Kpi label="Job value" value={fmtMoney(totals.jobValue)} hint="before tax" />
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
        <CardHeader title="Jobs & labour" subtitle="Painter budget against a 35–38% allowance calculated before tax" />
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
                  <th className="px-4 py-2.5 text-right font-medium">Amount (before tax)</th>
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
                      <button
                        type="button"
                        className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
                        onClick={() => setDetailsFor(r)}
                        aria-label={`View details for ${r.name}`}
                      >
                        <div className="truncate font-medium text-[var(--color-heading)] underline decoration-transparent underline-offset-4 transition-colors hover:text-[var(--color-brand-strong)] hover:decoration-current">
                          {r.name}
                        </div>
                        {r.address ? (
                          <div className="truncate text-xs text-[var(--color-muted)]">{r.address}</div>
                        ) : null}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-muted)]">
                      <div className="flex items-center justify-end gap-1.5">
                        <span title={r.amountSource === "calculator" ? "Synced from the default calculator" : undefined}>
                          {fmtMoney(r.amountBeforeTax)}
                        </span>
                        {canManage && r.amountSource !== "calculator" ? (
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

      {detailsFor ? (
        <JobDetailsDialog
          project={detailsFor}
          detail={detailsByProject[detailsFor.projectId]}
          taskProgress={taskProgressByProject[detailsFor.projectId] ?? []}
          onClose={() => setDetailsFor(null)}
        />
      ) : null}

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

function JobDetailsDialog({
  project,
  detail,
  taskProgress,
  onClose,
}: {
  project: ProjectRollup;
  detail?: ProjectDetail;
  taskProgress: ProjectTaskProgress[];
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const crew = detail?.crew ?? [];
  const labourExpenses = detail?.labourExpenses ?? [];
  const maxCrewHours = Math.max(...crew.map((member) => member.hours), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <Card className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-b-none sm:rounded-b-[var(--radius)]">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="job-details-title"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h2 id="job-details-title" className="font-display truncate text-lg font-semibold text-[var(--color-heading)]">
                  {project.name}
                </h2>
                {detail?.activeEntryCount ? <Badge tone="good">{detail.activeEntryCount} on clock</Badge> : null}
                {project.invoicedHours > project.clockedHours ? <Badge tone="neutral">invoice hours</Badge> : null}
                {project.expenseCount > 0 ? <Badge tone="neutral">{project.expenseCount} fixed {project.expenseCount === 1 ? "invoice" : "invoices"}</Badge> : null}
                <Badge tone={statusTone[project.status]}>
                  {project.wageSharePercent == null ? "no amount" : `${project.wageSharePercent.toFixed(1)}% of job`}
                </Badge>
                {project.unpricedHours > 0 ? <Badge tone="warn">{fmtHours(project.unpricedHours)} unpriced</Badge> : null}
              </div>
              {project.address ? <p className="text-sm text-[var(--color-muted)]">{project.address}</p> : null}
            </div>
            <Button variant="ghost" onClick={onClose} aria-label="Close job details" className="shrink-0">
              Close
            </Button>
          </div>

          <div className="max-h-[calc(92vh-77px)] overflow-y-auto p-5">
            <div className="mb-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <DetailMetric label="Job value" value={fmtMoney(project.amountBeforeTax)} />
              <DetailMetric
                label="Labour allowance"
                value={project.labourAllowanceLow != null && project.labourAllowanceHigh != null ? `${fmtMoney(project.labourAllowanceLow)}–${fmtMoney(project.labourAllowanceHigh)}` : "—"}
              />
              <DetailMetric label="Painter budget" value={project.labourExcluded ? "—" : fmtMoney(project.wageCost)} />
              <DetailMetric
                label="Used by painters"
                value={project.wageSharePercent != null ? `${project.wageSharePercent.toFixed(1)}%` : "—"}
                tone={project.status === "over" ? "bad" : undefined}
              />
            </div>
            {project.amountIncludingTax != null ? (
              <p className="mb-6 text-[11px] text-[var(--color-muted)]">
                {project.amountSource === "calculator"
                  ? `Synced automatically from the default calculator total of ${fmtMoney(project.amountIncludingTax)} including HST.`
                  : `Before-tax value is calculated live from ${fmtMoney(project.amountIncludingTax)} including HST.`}
              </p>
            ) : <div className="mb-6" />}

            {taskProgress.length > 0 ? (
              <section aria-labelledby="task-progress-title" className="mb-6">
                <div className="mb-3">
                  <h3 id="task-progress-title" className="font-display text-sm font-semibold text-[var(--color-heading)]">Task progress</h3>
                  <p className="text-xs text-[var(--color-muted)]">Hours painters tracked against each task&rsquo;s budget</p>
                </div>
                <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]">
                  {taskProgress.map((task, index) => {
                    const over = task.budgetedHours > 0 && task.spentHours > task.budgetedHours;
                    const percent = task.budgetedHours > 0 ? Math.min(100, (task.spentHours / task.budgetedHours) * 100) : 0;
                    const contributors = task.contributors.filter(
                      (contributor) => contributor.active || contributor.hours >= 1 / 60,
                    );
                    const onTaskNow = task.contributors.some((contributor) => contributor.active);
                    return (
                      <div
                        key={task.id}
                        className={`px-4 py-3 ${index > 0 ? "border-t border-[var(--color-border)]" : ""}`}
                      >
                        <div className="flex items-baseline justify-between gap-4">
                          <span className="truncate text-sm font-medium" title={task.notes ?? undefined}>{task.title}</span>
                          <span className="shrink-0 text-xs tabular-nums">
                            <span className={`font-semibold ${over ? "text-[var(--color-bad)]" : "text-[var(--color-heading)]"}`}>
                              {fmtHours(task.spentHours)}
                            </span>
                            {task.budgetedHours > 0 ? (
                              <span className="text-[var(--color-muted)]"> / {fmtHours(task.budgetedHours)}</span>
                            ) : null}
                          </span>
                        </div>
                        {task.budgetedHours > 0 ? (
                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${percent}%`, background: over ? "var(--color-bad)" : "var(--color-brand)" }}
                            />
                          </div>
                        ) : null}
                        {contributors.length > 0 || onTaskNow ? (
                          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
                            <span className="truncate">
                              {contributors
                                .map((contributor) => `${contributor.name} ${fmtHours(contributor.hours)}`)
                                .join(" · ")}
                            </span>
                            {onTaskNow ? (
                              <span className="shrink-0 font-medium text-[var(--color-good)]">● on task now</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
              <section aria-labelledby="crew-hours-title">
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <h3 id="crew-hours-title" className="font-display text-sm font-semibold text-[var(--color-heading)]">Hours by crew member</h3>
                    <p className="text-xs text-[var(--color-muted)]">{crew.length} {crew.length === 1 ? "person" : "people"} logged time</p>
                  </div>
                  <span className="text-xs text-[var(--color-muted)]">{detail?.entryCount ?? 0} entries</span>
                </div>

                {crew.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-muted)]">
                    No crew time entries have been recorded for this job.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {crew.map((member) => (
                      <div key={member.crewId} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                        <div className="flex items-center gap-3">
                          <Avatar label={initials(member.name)} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="truncate text-sm font-medium">{member.name}</span>
                              <span className="shrink-0 text-sm font-semibold tabular-nums">{fmtMoney(member.wageCost)}</span>
                            </div>
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                              <div
                                className="h-full rounded-full bg-[var(--color-brand)]"
                                style={{ width: `${maxCrewHours ? (member.hours / maxCrewHours) * 100 : 0}%` }}
                              />
                            </div>
                            <div className="mt-1.5 flex justify-between text-[11px] text-[var(--color-muted)]">
                              <span>{fmtHours(member.hours)} · {formatPayRates(member.hourlyRates)}</span>
                              <span>Last {fmtDate(member.lastActivity)}</span>
                            </div>
                            {member.unpricedHours > 0 ? (
                              <div className="mt-1 text-[11px] text-[var(--color-warn)]">{fmtHours(member.unpricedHours)} has no applicable pay rate</div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {labourExpenses.length > 0 ? (
                  <div className="mt-5">
                    <div className="mb-2">
                      <h4 className="font-display text-sm font-semibold text-[var(--color-heading)]">Fixed labour invoices</h4>
                      <p className="text-xs text-[var(--color-muted)]">Subcontract costs recorded without invented hours</p>
                    </div>
                    <div className="space-y-2">
                      {labourExpenses.map((expense) => (
                        <div key={expense.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                          <div className="flex items-start gap-3">
                            <Avatar label={initials(expense.workerName)} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-3">
                                <span className="truncate text-sm font-medium">{expense.workerName} · {expense.supplierName}</span>
                                <span className="shrink-0 text-sm font-semibold tabular-nums">{fmtMoney(expense.amountBeforeTax)}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-muted)]">
                                <span>Invoice #{expense.invoiceNumber}</span>
                                <span>·</span>
                                <span>{fmtDate(`${expense.invoiceDate}T12:00:00`)}</span>
                                {expense.taxAmount === 0 ? <Badge tone="neutral">No HST</Badge> : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>

              <section aria-labelledby="recent-entries-title">
                <div className="mb-3">
                  <h3 id="recent-entries-title" className="font-display text-sm font-semibold text-[var(--color-heading)]">Recent time entries</h3>
                  <p className="text-xs text-[var(--color-muted)]">The latest shifts logged to this job</p>
                </div>

                {!detail?.recentEntries.length ? (
                  <div className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-muted)]">
                    No time entries to show.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-sm">
                        <thead>
                          <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg)] text-left text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                            <th className="px-3 py-2 font-medium">Painter</th>
                            <th className="px-3 py-2 font-medium">Date</th>
                            <th className="px-3 py-2 font-medium">Time</th>
                            <th className="px-3 py-2 text-right font-medium">Hours</th>
                            <th className="px-3 py-2 text-right font-medium">Rate</th>
                            <th className="px-3 py-2 text-right font-medium">Wages</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.recentEntries.map((entry) => (
                            <tr key={entry.id} className="border-b border-[var(--color-border)] last:border-0">
                              <td className="max-w-[150px] px-3 py-2.5">
                                <div className="truncate font-medium">{entry.userName}</div>
                                {entry.notes ? <div className="truncate text-[11px] text-[var(--color-muted)]" title={entry.notes}>{entry.notes}</div> : null}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-[var(--color-muted)]">{fmtDate(entry.startedAt)}</td>
                              <td className="whitespace-nowrap px-3 py-2.5">{fmtTime(entry.startedAt)}–{entry.status === "active" ? "now" : fmtTime(entry.endedAt)}</td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">{fmtHours(entry.hours)}</td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[var(--color-muted)]">
                                {entry.hourlyRate != null ? `${fmtMoney(entry.hourlyRate)}/h` : "—"}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">
                                {entry.wageCost != null ? fmtMoney(entry.wageCost) : <Badge tone="warn">unpriced</Badge>}
                              </td>
                              <td className="px-3 py-2.5">
                                {entry.status === "active" ? (
                                  <Badge tone="good">on clock</Badge>
                                ) : entry.approved ? (
                                  <Badge tone="good">approved</Badge>
                                ) : (
                                  <Badge tone="warn">pending</Badge>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function DetailMetric({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone === "bad" ? "text-[var(--color-bad)]" : "text-[var(--color-heading)]"}`}>
        {value}
      </div>
    </div>
  );
}

function formatPayRates(rates: number[]): string {
  if (rates.length === 0) return "No rate";
  if (rates.length === 1) return `${fmtMoney(rates[0])}/h`;
  return `${fmtMoney(rates[0])}–${fmtMoney(rates[rates.length - 1])}/h`;
}

function AmountDialog({
  project,
  pending,
  onClose,
  onSave,
}: {
  project: ProjectRollup;
  pending: boolean;
  onClose: () => void;
  onSave: (input: {
    projectId: string;
    amountIncludingTax: number | null;
    notes?: string | null;
  }) => void;
}) {
  const [amount, setAmount] = useState(project.amountIncludingTax?.toString() ?? "");
  const numericAmount = amount.trim() === "" ? null : Number(amount);
  const preTax = amountBeforeTax(numericAmount);
  const allowanceLow = preTax != null ? preTax * (LABOUR_MIN_PERCENT / 100) : null;
  const allowanceHigh = preTax != null ? preTax * (LABOUR_MAX_PERCENT / 100) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5">
        <div onClick={(e) => e.stopPropagation()}>
          <h3 className="text-sm font-semibold">Job amount · {project.name}</h3>
          <p className="mb-4 text-xs text-[var(--color-muted)]">
            Enter the one customer amount including HST. Labour calculations remove tax automatically.
          </p>
          <Field label="Customer amount including HST (CAD)">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 5,650.00"
            />
          </Field>

          <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-[var(--color-muted)]">Job value before tax</span>
              <span className="font-semibold tabular-nums">{fmtMoney(preTax)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-[var(--color-muted)]">35–38% labour allowance</span>
              <span className="font-semibold tabular-nums">{allowanceLow != null && allowanceHigh != null ? `${fmtMoney(allowanceLow)}–${fmtMoney(allowanceHigh)}` : "—"}</span>
            </div>
            <p className="mt-3 text-[11px] leading-4 text-[var(--color-muted)]">
              If a change order changes the total, update this amount once and the labour figures recalculate immediately.
            </p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                onSave({
                  projectId: project.projectId,
                  amountIncludingTax: amount.trim() === "" ? null : Number(amount),
                })
              }
            >
              {pending ? "Saving…" : "Save amount"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
