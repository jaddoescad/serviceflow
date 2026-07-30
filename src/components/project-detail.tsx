"use client";

import { useState, useTransition } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
} from "@/components/ui";
import { Kpi } from "@/components/kpi";
import { fmtHours, fmtMoney, fmtDate, fmtTime, initials } from "@/lib/format";
import { setJobAmount, setLabourClosed } from "@/lib/actions/budgets";
import {
  LABOUR_ALERT_PERCENT,
  LABOUR_MAX_PERCENT,
  LABOUR_MIN_PERCENT,
} from "@/lib/metrics";
import type { BudgetStatus, ProjectDetail, ProjectRollup } from "@/lib/metrics";
import {
  allocateBonusByHours,
  calculateBonusPool,
} from "@/lib/bonus";

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
  const bonusPool = calculateBonusPool(
    project.amountBeforeTax,
    project.wageCost,
    LABOUR_ALERT_PERCENT,
  );
  const bonusAllocation = allocateBonusByHours(
    bonusPool ?? 0,
    crew.map((member) => ({
      id: member.crewId,
      name: member.name,
      hours: member.hours,
    })),
  );

  const labourClosed = Boolean(project.labourClosedAt);
  // Completing settles the job's labour cost, so it only makes sense once the
  // job has an amount to measure against. Excluded and untouched jobs opt out.
  const canCompleteLabour =
    project.labourBucket === "settled" ||
    project.labourBucket === "in_flight" ||
    project.labourBucket === "not_costed";

  function saveAmount(input: { projectId: string; amountBeforeTax: number | null }) {
    setError(null);
    startTransition(async () => {
      const res = await setJobAmount(input);
      if (!res.ok) setError(res.error ?? "Action failed");
      else setEditingAmount(false);
    });
  }

  function toggleLabourClosed(closed: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setLabourClosed({ projectId: project.projectId, closed });
      if (!res.ok) setError(res.error ?? "Action failed");
    });
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {labourClosed ? (
            <Badge tone="good">Labour completed {fmtDate(project.labourClosedAt)}</Badge>
          ) : canCompleteLabour ? (
            <Badge tone="neutral">Labour not completed</Badge>
          ) : null}
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
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => setEditingAmount(true)} disabled={pending}>
              Edit amount
            </Button>
            {canCompleteLabour ? (
              <Button
                variant={labourClosed ? "ghost" : "primary"}
                onClick={() => toggleLabourClosed(!labourClosed)}
                disabled={pending}
                title={
                  labourClosed
                    ? "Reopen if another painter invoice still has to land"
                    : "Mark once every painter invoice for this job is in. Only completed jobs count toward the headline labour share."
                }
              >
                {labourClosed ? "Reopen labour" : "Mark job completed"}
              </Button>
            ) : project.labourBucket === "missing_amount" ? (
              <span className="text-xs text-[var(--color-warn)]">
                Set a job amount before completing
              </span>
            ) : null}
          </div>
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
          hint="35–37% of the job amount"
        />
        <Kpi
          label="Painter budget"
          value={project.labourExcluded ? "—" : fmtMoney(project.wageCost)}
          hint={`larger of invoices or clocked wages · ${
            project.labourCostSource === "invoices"
              ? "invoices chosen"
              : "clocked wages chosen"
          }`}
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

      <PainterBonus
        project={project}
        crew={crew}
        bonusPool={bonusPool}
        totalHours={bonusAllocation.totalHours}
        allocations={bonusAllocation.allocations}
      />

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

function PainterBonus({
  project,
  crew,
  bonusPool,
  totalHours,
  allocations,
}: {
  project: ProjectRollup;
  crew: ProjectDetail["crew"];
  bonusPool: number | null;
  totalHours: number;
  allocations: ReturnType<typeof allocateBonusByHours>["allocations"];
}) {
  const allowance =
    project.amountBeforeTax == null
      ? null
      : project.amountBeforeTax * (LABOUR_ALERT_PERCENT / 100);
  const sourceLabel =
    project.labourCostSource === "invoices"
      ? "labour invoices"
      : "clocked wages";
  const isFinal = Boolean(project.labourClosedAt);

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader
        title="Painter bonus"
        subtitle="The amount left inside the 40% painter budget, split by each painter’s share of clocked hours"
        right={
          <Badge tone={isFinal ? "good" : "warn"}>
            {isFinal ? "Final" : "Live estimate"}
          </Badge>
        }
      />

      {bonusPool == null || allowance == null ? (
        <div className="px-5 py-8 text-center text-sm text-[var(--color-muted)]">
          Set the job amount before HST to calculate the painter bonus.
        </div>
      ) : (
        <>
          <div className="grid gap-px border-b border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-3">
            <div className="bg-[var(--color-surface)] px-5 py-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                40% painter budget
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--color-heading)]">
                {fmtMoney(allowance)}
              </div>
            </div>
            <div className="bg-[var(--color-surface)] px-5 py-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                Painter cost
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--color-heading)]">
                {fmtMoney(project.wageCost)}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                {sourceLabel} chosen
              </div>
            </div>
            <div className="bg-[var(--color-surface)] px-5 py-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                {isFinal ? "Final bonus pool" : "Estimated bonus pool"}
              </div>
              <div
                className={`mt-1 text-xl font-semibold tabular-nums ${
                  bonusPool > 0
                    ? "text-[var(--color-good)]"
                    : "text-[var(--color-muted)]"
                }`}
              >
                {fmtMoney(bonusPool)}
              </div>
            </div>
          </div>

          {crew.length === 0 || allocations.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-[var(--color-muted)]">
                No clocked painter hours are available to split this bonus.
              </p>
              <p className="mt-1 text-[11px] text-[var(--color-muted)]">
                Invoice costs can set the pool, but a painter needs clocked hours
                to receive a share.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg)] text-left text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                    <th className="px-5 py-2.5 font-medium">Painter</th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      Hours
                    </th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      Share
                    </th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      Bonus
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((allocation) => (
                    <tr
                      key={allocation.id}
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar label={initials(allocation.name)} />
                          <span className="font-medium">{allocation.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-[var(--color-muted)]">
                        {fmtHours(allocation.hours)}
                      </td>
                      <td className="px-5 py-3 text-right font-medium tabular-nums">
                        {allocation.sharePercent.toFixed(1)}%
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-[var(--color-good)]">
                        {fmtMoney(allocation.bonusAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--color-border)] bg-[var(--color-bg)] font-medium">
                    <td className="px-5 py-3">Total</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {fmtHours(totalHours)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      100.0%
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">
                      {fmtMoney(bonusPool)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="border-t border-[var(--color-border)] px-5 py-3 text-[11px] leading-4 text-[var(--color-muted)]">
            {allocations.length > 0 ? (
              <>
                Each painter receives their clocked hours ÷ {fmtHours(totalHours)} total
                hours × {fmtMoney(bonusPool)}.{" "}
              </>
            ) : (
              <>The bonus can be split once painter hours are clocked. </>
            )}
            {sourceLabel === "labour invoices"
              ? "Invoices determine the painter cost; clocked hours only determine the split."
              : "Clocked wages determine the painter cost and clocked hours determine the split."}
          </div>
        </>
      )}
    </Card>
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
              <span className="text-[var(--color-muted)]">35–37% labour allowance</span>
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
