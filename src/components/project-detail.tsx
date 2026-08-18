"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Stat,
  StatGrid,
  StatusText,
} from "@/components/ui";
import { fmtHours, fmtMoney, fmtDate, initials } from "@/lib/format";
import { setJobAmount, setLabourClosed } from "@/lib/actions/budgets";
import {
  LABOUR_ALERT_PERCENT,
  LABOUR_MAX_PERCENT,
  LABOUR_MIN_PERCENT,
} from "@/lib/metrics";
import type { ProjectDetail, ProjectRollup } from "@/lib/metrics";
import {
  allocateBonusByHours,
  calculateBonusPool,
} from "@/lib/bonus";

/** Consolidated overview: one labour summary and one combined labour-cost table. */
export function ProjectOverviewPanel({
  project,
  detail,
  canManage,
  materialCostSummary,
}: {
  project: ProjectRollup;
  detail?: ProjectDetail;
  canManage: boolean;
  materialCostSummary: {
    invoiceCount: number;
    amountBeforeTax: number;
  };
}) {
  const [editingAmount, setEditingAmount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const crew = detail?.crew ?? [];
  const labourExpenses = detail?.labourExpenses ?? [];
  const labourInvoices = [
    ...labourExpenses
      .reduce((byInvoice, expense) => {
        const current = byInvoice.get(expense.invoiceId);
        if (current) {
          current.amountBeforeTax += expense.amountBeforeTax;
          current.taxAmount += expense.taxAmount;
        } else {
          byInvoice.set(expense.invoiceId, { ...expense });
        }
        return byInvoice;
      }, new Map<string, (typeof labourExpenses)[number]>())
      .values(),
  ];
  const totalClockedHours = crew.reduce((sum, member) => sum + member.hours, 0);
  const invoicedTotal = labourInvoices.reduce(
    (sum, invoice) => sum + invoice.amountBeforeTax,
    0,
  );
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
  const bonusByCrewId = new Map(
    bonusAllocation.allocations.map((allocation) => [allocation.id, allocation]),
  );
  const allowance =
    project.amountBeforeTax == null
      ? null
      : project.amountBeforeTax * (LABOUR_ALERT_PERCENT / 100);
  const budgetVariance = allowance == null ? null : allowance - project.wageCost;
  const costSourceHint =
    project.labourCostSource === "invoices"
      ? "Labour invoices selected"
      : invoicedTotal > 0
        ? `Clocked wages selected · ${fmtMoney(project.clockedWageCost - invoicedTotal)} above invoices`
        : "Clocked wages selected";
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
      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bad-soft)] px-4 py-2 text-sm text-[var(--color-bad)]"
        >
          {error}
        </div>
      ) : null}

      <div className="min-w-0 space-y-5">
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[var(--color-border)] px-5 py-4 md:flex-row md:items-center md:justify-between">
              <h3 className="font-display text-sm font-semibold text-[var(--color-heading)]">
                Job financials
              </h3>
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                {activeEntryCount > 0 ? (
                  <StatusText tone="good">{activeEntryCount} on clock</StatusText>
                ) : null}
                <Badge tone={labourClosed ? "good" : "warn"}>
                  {labourClosed
                    ? `Completed ${fmtDate(project.labourClosedAt)}`
                    : "Labour not completed"}
                </Badge>
                {canManage ? (
                  <>
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() => setEditingAmount(true)}
                      disabled={pending}
                    >
                      Edit job value
                    </Button>
                    {canCompleteLabour ? (
                      <Button
                        size="sm"
                        variant={labourClosed ? "ghost" : "primary"}
                        onClick={() => toggleLabourClosed(!labourClosed)}
                        disabled={pending}
                        aria-describedby="labour-completion-help"
                      >
                        {labourClosed ? "Reopen labour" : "Mark job completed"}
                      </Button>
                    ) : project.labourBucket === "missing_amount" ? (
                      <span className="text-xs text-[var(--color-warn)]">
                        Set a job value before completing
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
              <span id="labour-completion-help" className="sr-only">
                Mark complete once every painter invoice for this job is recorded. Reopen labour if another painter invoice still needs to be added.
              </span>
            </div>

            <StatGrid columns={5} className="border-b border-[var(--color-border)]">
              <Stat
                label="Job value"
                value={
                  project.amountBeforeTax == null
                    ? "—"
                    : fmtMoney(project.amountBeforeTax)
                }
                hint="Before HST"
              />
              <Stat
                label="Labour budget"
                value={allowance == null ? "—" : fmtMoney(allowance)}
                hint="40% of job value"
              />
              <Stat
                label="Labour cost"
                value={project.labourExcluded ? "—" : fmtMoney(project.wageCost)}
                hint={project.labourExcluded ? undefined : costSourceHint}
              />
              <Stat
                label="Material cost"
                value={fmtMoney(materialCostSummary.amountBeforeTax)}
                hint={
                  materialCostSummary.invoiceCount > 0
                    ? `${materialCostSummary.invoiceCount} allocated ${materialCostSummary.invoiceCount === 1 ? "invoice" : "invoices"} · before HST`
                    : "No material invoices linked"
                }
              />
              <Stat
                label="Budget position"
                value={
                  budgetVariance == null
                    ? "—"
                    : budgetVariance >= 0
                      ? `${fmtMoney(budgetVariance)} remaining`
                      : `${fmtMoney(Math.abs(budgetVariance))} over`
                }
                hint={
                  project.wageSharePercent == null
                    ? undefined
                    : `${project.wageSharePercent.toFixed(1)}% of job value`
                }
                tone={budgetVariance == null ? "neutral" : budgetVariance >= 0 ? "good" : "bad"}
              />
            </StatGrid>

            {crew.length === 0 && labourInvoices.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-[var(--color-muted)]">
                No labour costs have been recorded for this job.
              </div>
            ) : (
              <div>
                <section aria-labelledby="crew-cost-table-title">
                  <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-3">
                    <h4 id="crew-cost-table-title" className="text-sm font-semibold text-[var(--color-heading)]">
                      Crew
                    </h4>
                  </div>
                  {crew.length === 0 ? (
                    <div className="px-5 py-7 text-sm text-[var(--color-muted)]">
                      No crew time has been recorded.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-[13px]">
                        <thead>
                          <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-[0.08em] text-[var(--color-muted)]">
                            <th className="px-5 py-2.5 font-medium">Painter</th>
                            <th className="px-4 py-2.5 text-right font-medium">Hours</th>
                            <th className="px-4 py-2.5 text-right font-medium">Wages</th>
                            <th className="px-5 py-2.5 text-right font-medium">Bonus</th>
                          </tr>
                        </thead>
                        <tbody>
                          {crew.map((member) => {
                            const allocation = bonusByCrewId.get(member.crewId);
                            return (
                              <tr key={member.crewId} className="border-b border-[var(--color-border)]">
                                <td className="px-5 py-3.5">
                                  <div className="flex items-center gap-3">
                                    <Avatar label={initials(member.name)} />
                                    <div className="min-w-0">
                                      <div className="truncate font-medium text-[var(--color-heading)]">
                                        {member.name}
                                      </div>
                                      <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                                        Last {fmtDate(member.lastActivity)} · {formatPayRates(member.hourlyRates)}
                                        {allocation ? ` · ${allocation.sharePercent.toFixed(1)}% of hours` : ""}
                                      </div>
                                      {member.unpricedHours > 0 ? (
                                        <div className="mt-0.5 text-[11px] text-[var(--color-warn)]">
                                          {fmtHours(member.unpricedHours)} unpriced
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </td>
                                <td className="whitespace-nowrap px-4 py-3.5 text-right font-medium tabular-nums">
                                  {fmtHours(member.hours)}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3.5 text-right font-medium tabular-nums">
                                  {fmtMoney(member.wageCost)}
                                </td>
                                <td className="whitespace-nowrap px-5 py-3.5 text-right font-semibold tabular-nums text-[var(--color-good)]">
                                  {allocation ? fmtMoney(allocation.bonusAmount) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        {crew.length > 1 ? (
                          <tfoot>
                            <tr className="bg-[var(--color-surface-2)] font-semibold text-[var(--color-heading)]">
                              <td className="px-5 py-3">Total</td>
                              <td className="px-4 py-3 text-right tabular-nums">{fmtHours(totalClockedHours)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(project.clockedWageCost)}</td>
                              <td className="px-5 py-3 text-right tabular-nums text-[var(--color-good)]">
                                {bonusPool == null ? "—" : fmtMoney(bonusPool)}
                              </td>
                            </tr>
                          </tfoot>
                        ) : null}
                      </table>
                    </div>
                  )}
                </section>

                <section aria-labelledby="labour-invoice-table-title" className="border-t border-[var(--color-border)]">
                  <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-3">
                    <h4 id="labour-invoice-table-title" className="text-sm font-semibold text-[var(--color-heading)]">
                      Labour invoices
                    </h4>
                  </div>
                  {labourInvoices.length === 0 ? (
                    <div className="px-5 py-7 text-sm text-[var(--color-muted)]">
                      No active labour invoices are linked to this job.
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[480px] text-[13px]">
                          <thead>
                            <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-[0.08em] text-[var(--color-muted)]">
                              <th className="px-5 py-2.5 font-medium">Vendor / invoice</th>
                              <th className="px-4 py-2.5 font-medium">Date</th>
                              <th className="px-5 py-2.5 text-right font-medium">Labour · before HST</th>
                            </tr>
                          </thead>
                          <tbody>
                            {labourInvoices.map((expense) => (
                              <tr key={expense.invoiceId} className="border-b border-[var(--color-border)]">
                                <td className="px-5 py-3.5">
                                  <div className="flex items-center gap-3">
                                    <Avatar label={initials(expense.workerName)} />
                                    <div className="min-w-0">
                                      <div className="truncate font-medium text-[var(--color-heading)]">
                                        {expense.workerName}
                                      </div>
                                      <Link
                                        href={`/invoices/${encodeURIComponent(expense.invoiceId)}`}
                                        prefetch={false}
                                        className="mt-0.5 inline-block text-[11px] font-medium text-[var(--color-brand-strong)] hover:underline"
                                      >
                                        Invoice #{expense.invoiceNumber}
                                      </Link>
                                    </div>
                                  </div>
                                </td>
                                <td className="whitespace-nowrap px-4 py-3.5 text-[var(--color-muted)]">
                                  {fmtDate(`${expense.invoiceDate}T12:00:00`)}
                                </td>
                                <td className="whitespace-nowrap px-5 py-3.5 text-right font-semibold tabular-nums">
                                  {fmtMoney(expense.amountBeforeTax)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {labourInvoices.length > 1 ? (
                            <tfoot>
                              <tr className="bg-[var(--color-surface-2)] font-semibold text-[var(--color-heading)]">
                                <td className="px-5 py-3" colSpan={2}>Total</td>
                                <td className="px-5 py-3 text-right tabular-nums">{fmtMoney(invoicedTotal)}</td>
                              </tr>
                            </tfoot>
                          ) : null}
                        </table>
                      </div>
                    </>
                  )}
                </section>
              </div>
            )}
          </Card>
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
  onSave: (input: { projectId: string; amountBeforeTax: number | null }) => void;
}) {
  const [amount, setAmount] = useState(project.amountBeforeTax?.toString() ?? "");
  const dialogRef = useRef<HTMLDivElement>(null);
  const numericAmount = amount.trim() === "" ? null : Number(amount);
  const allowanceLow = numericAmount != null ? numericAmount * (LABOUR_MIN_PERCENT / 100) : null;
  const allowanceHigh = numericAmount != null ? numericAmount * (LABOUR_MAX_PERCENT / 100) : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose, pending]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="job-amount-dialog-title"
          aria-describedby="job-amount-dialog-description"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className="outline-none"
        >
          <h3 id="job-amount-dialog-title" className="text-sm font-semibold">
            Job amount · {project.name}
          </h3>
          <p id="job-amount-dialog-description" className="mb-4 text-xs text-[var(--color-muted)]">
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
