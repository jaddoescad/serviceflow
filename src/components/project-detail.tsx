"use client";

import { useState, useTransition } from "react";
import { Avatar, Badge, Button, Card, Field, Input } from "@/components/ui";
import { Kpi } from "@/components/kpi";
import { fmtHours, fmtMoney, fmtDate, fmtTime, initials } from "@/lib/format";
import { setJobAmount } from "@/lib/actions/budgets";
import { LABOUR_MAX_PERCENT, LABOUR_MIN_PERCENT } from "@/lib/metrics";
import type { BudgetStatus, ProjectDetail, ProjectRollup } from "@/lib/metrics";

const statusTone: Record<BudgetStatus, "good" | "warn" | "bad" | "neutral"> = {
  under: "good",
  near: "warn",
  over: "bad",
  none: "neutral",
};

/** Overview tab content: money KPIs, crew hours, invoices, recent entries. */
export function ProjectOverviewPanel({
  project,
  detail,
  canManage,
}: {
  project: ProjectRollup;
  detail?: ProjectDetail;
  canManage: boolean;
}) {
  const [editingAmount, setEditingAmount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const crew = detail?.crew ?? [];
  const labourExpenses = detail?.labourExpenses ?? [];
  const maxCrewHours = Math.max(...crew.map((member) => member.hours), 0);
  const activeEntryCount = detail?.activeEntryCount ?? 0;

  function saveAmount(input: { projectId: string; amountBeforeTax: number | null }) {
    setError(null);
    startTransition(async () => {
      const res = await setJobAmount(input);
      if (!res.ok) setError(res.error ?? "Action failed");
      else setEditingAmount(false);
    });
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {activeEntryCount > 0 ? <Badge tone="good">{activeEntryCount} on clock</Badge> : null}
          {project.invoicedHours > project.clockedHours ? <Badge tone="neutral">invoice hours</Badge> : null}
          {project.expenseCount > 0 ? (
            <Badge tone="neutral">
              {project.expenseCount} fixed {project.expenseCount === 1 ? "invoice" : "invoices"}
            </Badge>
          ) : null}
          <Badge tone={statusTone[project.status]}>
            {project.wageSharePercent == null ? "no amount" : `${project.wageSharePercent.toFixed(1)}% of job`}
          </Badge>
          {project.unpricedHours > 0 ? <Badge tone="warn">{fmtHours(project.unpricedHours)} unpriced</Badge> : null}
        </div>
        {canManage ? (
          <Button variant="ghost" onClick={() => setEditingAmount(true)} disabled={pending}>
            Edit amount
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bad-soft)] px-4 py-2 text-sm text-[var(--color-bad)]">
          {error}
        </div>
      ) : null}

      <div className="mb-2 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Job value" value={fmtMoney(project.amountBeforeTax)} hint="before HST" />
        <Kpi
          label="Labour allowance"
          value={
            project.labourAllowanceLow != null && project.labourAllowanceHigh != null
              ? `${fmtMoney(project.labourAllowanceLow)}–${fmtMoney(project.labourAllowanceHigh)}`
              : "—"
          }
          hint="35–38% of the job amount"
        />
        <Kpi
          label="Painter budget"
          value={project.labourExcluded ? "—" : fmtMoney(project.wageCost)}
          hint="timesheets + fixed invoices"
        />
        <Kpi
          label="Used by painters"
          value={project.wageSharePercent != null ? `${project.wageSharePercent.toFixed(1)}%` : "—"}
          tone={project.status === "over" ? "bad" : project.status === "near" ? "warn" : "neutral"}
          hint="of the job amount"
        />
      </div>
      {project.amountBeforeTax != null ? (
        <p className="mb-6 text-[11px] text-[var(--color-muted)]">
          Manual job amount before HST. No tax is added or removed.
        </p>
      ) : (
        <div className="mb-6" />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <section aria-labelledby="crew-hours-title">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h3 id="crew-hours-title" className="font-display text-sm font-semibold text-[var(--color-heading)]">
                Hours by crew member
              </h3>
              <p className="text-xs text-[var(--color-muted)]">
                {crew.length} {crew.length === 1 ? "person" : "people"} logged time
              </p>
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
                <div key={member.crewId} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
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
                        <span>
                          {fmtHours(member.hours)} · {formatPayRates(member.hourlyRates)}
                        </span>
                        <span>Last {fmtDate(member.lastActivity)}</span>
                      </div>
                      {member.unpricedHours > 0 ? (
                        <div className="mt-1 text-[11px] text-[var(--color-warn)]">
                          {fmtHours(member.unpricedHours)} has no applicable pay rate
                        </div>
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
                  <div key={expense.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                    <div className="flex items-start gap-3">
                      <Avatar label={initials(expense.workerName)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-sm font-medium">
                            {expense.workerName} · {expense.supplierName}
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            {fmtMoney(expense.amountBeforeTax)}
                          </span>
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
            <h3 id="recent-entries-title" className="font-display text-sm font-semibold text-[var(--color-heading)]">
              Recent time entries
            </h3>
            <p className="text-xs text-[var(--color-muted)]">The latest shifts logged to this job</p>
          </div>

          {!detail?.recentEntries.length ? (
            <div className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-muted)]">
              No time entries to show.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
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
                          {entry.notes ? (
                            <div className="truncate text-[11px] text-[var(--color-muted)]" title={entry.notes}>
                              {entry.notes}
                            </div>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-[var(--color-muted)]">{fmtDate(entry.startedAt)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          {fmtTime(entry.startedAt)}–{entry.status === "active" ? "now" : fmtTime(entry.endedAt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">
                          {fmtHours(entry.hours)}
                        </td>
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

      {editingAmount ? (
        <AmountDialog
          project={project}
          pending={pending}
          onClose={() => setEditingAmount(false)}
          onSave={saveAmount}
        />
      ) : null}
    </>
  );
}

function formatPayRates(rates: number[]): string {
  if (rates.length === 0) return "No rate";
  if (rates.length === 1) return `${fmtMoney(rates[0])}/h`;
  return `${fmtMoney(rates[0])}–${fmtMoney(rates[rates.length - 1])}/h`;
}

export function AmountDialog({
  project,
  pending,
  onClose,
  onSave,
}: {
  project: ProjectRollup;
  pending: boolean;
  onClose: () => void;
  onSave: (input: { projectId: string; amountBeforeTax: number | null; notes?: string | null }) => void;
}) {
  const [amount, setAmount] = useState(project.amountBeforeTax?.toString() ?? "");
  const numericAmount = amount.trim() === "" ? null : Number(amount);
  const allowanceLow = numericAmount != null ? numericAmount * (LABOUR_MIN_PERCENT / 100) : null;
  const allowanceHigh = numericAmount != null ? numericAmount * (LABOUR_MAX_PERCENT / 100) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5">
        <div onClick={(e) => e.stopPropagation()}>
          <h3 className="text-sm font-semibold">Job amount · {project.name}</h3>
          <p className="mb-4 text-xs text-[var(--color-muted)]">
            Enter the job amount before HST. The dashboard uses exactly what you enter.
          </p>
          <Field label="Job amount before HST (CAD)">
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
              <span className="text-[var(--color-muted)]">Entered job amount</span>
              <span className="font-semibold tabular-nums">{fmtMoney(numericAmount)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-[var(--color-muted)]">35–38% labour allowance</span>
              <span className="font-semibold tabular-nums">
                {allowanceLow != null && allowanceHigh != null
                  ? `${fmtMoney(allowanceLow)}–${fmtMoney(allowanceHigh)}`
                  : "—"}
              </span>
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
                  amountBeforeTax: amount.trim() === "" ? null : Number(amount),
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
