import Link from "next/link";
import { Card, CardHeader, Badge, Button } from "@/components/ui";
import { fmtHours, fmtMoney } from "@/lib/format";
import { budgetStatus, LABOUR_ALERT_PERCENT, type BudgetStatus, type LabourSummary } from "@/lib/metrics";

export type BudgetItem = {
  projectId: string;
  name: string;
  amountBeforeTax: number;
  wageCost: number;
  wageSharePercent: number;
  allowanceLow: number;
  allowanceHigh: number;
  unpricedHours: number;
  status: BudgetStatus;
  /** Labour closed: the cost is final, so this job counts toward the headline. */
  settled: boolean;
};

function statusColor(status: BudgetStatus): string {
  return status === "over"
    ? "var(--color-bad)"
    : status === "near"
      ? "var(--color-warn)"
      : "var(--color-good)";
}

function Track({
  wageShare,
  status,
  height = 8,
  muted = false,
}: {
  wageShare: number;
  status: BudgetStatus;
  height?: number;
  muted?: boolean;
}) {
  const progressToAlert = (wageShare / LABOUR_ALERT_PERCENT) * 100;
  return (
    <div
      className="relative w-full overflow-hidden rounded-full"
      style={{ height, background: "color-mix(in srgb, var(--color-muted) 20%, transparent)" }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.min(100, Math.max(wageShare > 0 ? 2 : 0, progressToAlert))}%`,
          background: muted ? "var(--color-muted)" : statusColor(status),
        }}
      />
    </div>
  );
}

export function BudgetHealth({ items, summary }: { items: BudgetItem[]; summary: LabourSummary }) {
  const settledShare = summary.settled.sharePercent;
  const settledStatus = budgetStatus(settledShare);

  // Settled work first, then the biggest in-flight jobs: an open job's share is
  // only a running total, so it never outranks a final number.
  const sorted = [...items].sort((a, b) => {
    if (a.settled !== b.settled) return a.settled ? -1 : 1;
    return b.wageSharePercent - a.wageSharePercent;
  });
  const shown = sorted.slice(0, 6);
  const unpriced = items.filter((item) => item.unpricedHours > 0).length;
  const hasAnyJobs = items.length > 0 || summary.notCosted.count > 0 || summary.missingAmount.count > 0;

  return (
    <Card>
      <CardHeader
        title="Labour allowance health"
        subtitle="Completed jobs against 35–37% of the entered job amount"
        right={
          <div className="flex flex-wrap gap-2">
            {summary.readyToCloseCount ? (
              <Badge tone="warn">{summary.readyToCloseCount} ready to complete</Badge>
            ) : null}
            {unpriced ? <Badge tone="warn">{unpriced} with unpriced time</Badge> : null}
            <Badge tone={summary.overCount ? "bad" : "good"}>
              {summary.overCount ? `${summary.overCount} at 40% or higher` : "all below 40%"}
            </Badge>
          </div>
        }
      />

      {!hasAnyJobs ? (
        <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
          <p className="text-sm text-[var(--color-muted)]">
            Add a customer amount to a job to calculate its labour allowance automatically.
          </p>
          <Link href="/jobs"><Button size="sm">Add job amounts</Button></Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-5 border-b border-[var(--color-border)] px-5 py-5 lg:flex-row lg:items-center lg:gap-8">
            <div className="shrink-0">
              {settledShare == null ? (
                <>
                  <div className="font-display text-4xl font-semibold leading-none text-[var(--color-muted)]">—</div>
                  <div className="mt-1.5 max-w-[15rem] text-xs text-[var(--color-muted)]">
                    no completed jobs yet — mark labour completed to see your true share
                  </div>
                </>
              ) : (
                <>
                  <div
                    className="font-display text-4xl font-semibold tabular-nums leading-none"
                    style={{ color: statusColor(settledStatus) }}
                  >
                    {settledShare.toFixed(1)}%
                  </div>
                  <div className="mt-1.5 text-xs text-[var(--color-muted)]">
                    labour share on completed jobs
                  </div>
                </>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Track wageShare={settledShare ?? 0} status={settledStatus} height={12} muted={settledShare == null} />
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
                <span>
                  <strong className="text-[var(--color-text)]">{fmtMoney(summary.settled.labourCost)}</strong> painter
                  cost on {summary.settled.count} completed {summary.settled.count === 1 ? "job" : "jobs"}
                </span>
                <span>{fmtMoney(summary.settled.jobValue)} of job value, before HST</span>
              </div>
            </div>
          </div>

          {summary.inFlight.count > 0 ? (
            <div className="flex flex-col gap-3 border-b border-[var(--color-border)] px-5 py-4 lg:flex-row lg:items-center lg:gap-8">
              <div className="shrink-0 lg:w-[7.5rem]">
                <div className="font-display text-2xl font-semibold tabular-nums leading-none text-[var(--color-muted)]">
                  {summary.inFlight.sharePercent != null ? `${summary.inFlight.sharePercent.toFixed(1)}%` : "—"}
                  <span className="ml-1.5 text-xs font-normal">so far</span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  {summary.inFlight.count} {summary.inFlight.count === 1 ? "job" : "jobs"} not completed
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <Track wageShare={summary.inFlight.sharePercent ?? 0} status="none" muted />
                <div className="mt-2 text-xs text-[var(--color-muted)]">
                  {fmtMoney(summary.inFlight.labourCost)} spent so far against{" "}
                  {fmtMoney(summary.inFlight.jobValue)} of job value. Incomplete — this share only rises as the
                  remaining hours and invoices land.
                </div>
              </div>
            </div>
          ) : null}

          {summary.notCosted.count > 0 || summary.missingAmount.count > 0 ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--color-border)] px-5 py-3 text-xs text-[var(--color-muted)]">
              {summary.notCosted.count > 0 ? (
                <span>
                  <strong className="text-[var(--color-text)]">{summary.notCosted.count}</strong>{" "}
                  {summary.notCosted.count === 1 ? "job" : "jobs"} not costed yet ·{" "}
                  {fmtMoney(summary.notCosted.jobValue)} of job value with no hours or invoices
                </span>
              ) : null}
              {summary.missingAmount.count > 0 ? (
                <span>
                  <strong className="text-[var(--color-text)]">{summary.missingAmount.count}</strong>{" "}
                  {summary.missingAmount.count === 1 ? "job" : "jobs"} missing a job amount ·{" "}
                  {fmtMoney(summary.missingAmount.labourCost)} of labour that cannot be measured
                </span>
              ) : null}
            </div>
          ) : null}

          {shown.length > 0 ? (
            <div className="grid grid-cols-1 gap-x-8 gap-y-5 px-5 py-5 lg:grid-cols-2">
              {shown.map((item) => (
                <div key={item.projectId} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={`truncate text-sm font-medium ${
                        item.settled ? "text-[var(--color-heading)]" : "text-[var(--color-muted)]"
                      }`}
                    >
                      {item.name}
                    </span>
                    <span
                      className="shrink-0 text-xs font-semibold tabular-nums"
                      style={{ color: item.settled ? statusColor(item.status) : "var(--color-muted)" }}
                    >
                      {item.wageSharePercent.toFixed(1)}% of job{item.settled ? "" : " so far"}
                    </span>
                  </div>
                  <Track wageShare={item.wageSharePercent} status={item.status} muted={!item.settled} />
                  <div className="text-xs text-[var(--color-muted)]">
                    <span>
                      {fmtMoney(item.wageCost)} used by painters
                      {item.settled ? "" : " to date"}
                    </span>
                  </div>
                  {item.unpricedHours > 0 ? (
                    <span className="text-[11px] text-[var(--color-warn)]">
                      {fmtHours(item.unpricedHours)} still needs a pay rate
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {sorted.length > shown.length ? (
            <div className="border-t border-[var(--color-border)] px-5 py-3 text-center">
              <Link href="/jobs" className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline">
                View all {sorted.length} jobs on Jobs &amp; Labour →
              </Link>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
