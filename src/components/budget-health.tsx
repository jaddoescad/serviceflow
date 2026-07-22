import Link from "next/link";
import { Card, CardHeader, Badge, Button } from "@/components/ui";
import { fmtHours, fmtMoney } from "@/lib/format";
import { budgetStatus, LABOUR_ALERT_PERCENT, type BudgetStatus } from "@/lib/metrics";

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
};

function statusColor(status: BudgetStatus): string {
  return status === "over"
    ? "var(--color-bad)"
    : status === "near"
      ? "var(--color-warn)"
      : "var(--color-good)";
}

function Track({ wageShare, status, height = 8 }: { wageShare: number; status: BudgetStatus; height?: number }) {
  const progressToAlert = (wageShare / LABOUR_ALERT_PERCENT) * 100;
  return (
    <div
      className="relative w-full overflow-hidden rounded-full"
      style={{ height, background: "color-mix(in srgb, var(--color-muted) 20%, transparent)" }}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min(100, Math.max(wageShare > 0 ? 2 : 0, progressToAlert))}%`, background: statusColor(status) }}
      />
    </div>
  );
}

export function BudgetHealth({ items }: { items: BudgetItem[] }) {
  const totalJobValue = items.reduce((sum, item) => sum + item.amountBeforeTax, 0);
  const totalWages = items.reduce((sum, item) => sum + item.wageCost, 0);
  const overallShare = totalJobValue > 0 ? (totalWages / totalJobValue) * 100 : 0;
  const overallStatus = budgetStatus(overallShare);

  const counts = {
    over: items.filter((item) => item.status === "over").length,
  };
  const unpriced = items.filter((item) => item.unpricedHours > 0).length;
  const sorted = [...items].sort((a, b) => b.wageSharePercent - a.wageSharePercent);
  const shown = sorted.slice(0, 6);
  const more = sorted.length - shown.length;

  return (
    <Card>
      <CardHeader
        title="Labour allowance health"
        subtitle="Painter budget against 35–38% of the entered job amount"
        right={
          <div className="flex gap-2">
            {unpriced ? <Badge tone="warn">{unpriced} with unpriced time</Badge> : null}
            <Badge tone={counts.over ? "bad" : "good"}>
              {counts.over ? `${counts.over} at 40% or higher` : "all below 40%"}
            </Badge>
          </div>
        }
      />

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
          <p className="text-sm text-[var(--color-muted)]">
            Add a customer amount to a job to calculate its labour allowance automatically.
          </p>
          <Link href="/projects"><Button size="sm">Add job amounts</Button></Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-5 border-b border-[var(--color-border)] px-5 py-5 lg:flex-row lg:items-center lg:gap-8">
            <div className="shrink-0">
              <div className="font-display text-4xl font-semibold tabular-nums leading-none" style={{ color: statusColor(overallStatus) }}>
                {overallShare.toFixed(1)}%
              </div>
              <div className="mt-1.5 text-xs text-[var(--color-muted)]">
                wages as a share of job value
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <Track wageShare={overallShare} status={overallStatus} height={12} />
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
                <span><strong className="text-[var(--color-text)]">{fmtMoney(totalWages)}</strong> painter budget</span>
                <span>{overallShare.toFixed(1)}% of the total pre-tax job amount used by painters</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-x-8 gap-y-5 px-5 py-5 lg:grid-cols-2">
            {shown.map((item) => (
              <div key={item.projectId} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium text-[var(--color-heading)]">{item.name}</span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums" style={{ color: statusColor(item.status) }}>
                    {item.wageSharePercent.toFixed(1)}% of job
                  </span>
                </div>
                <Track wageShare={item.wageSharePercent} status={item.status} />
                <div className="text-xs text-[var(--color-muted)]">
                  <span>{fmtMoney(item.wageCost)} wages · {item.wageSharePercent.toFixed(1)}% used by painters</span>
                </div>
                {item.unpricedHours > 0 ? (
                  <span className="text-[11px] text-[var(--color-warn)]">{fmtHours(item.unpricedHours)} still needs a pay rate</span>
                ) : null}
              </div>
            ))}
          </div>

          {more > 0 ? (
            <div className="border-t border-[var(--color-border)] px-5 py-3 text-center">
              <Link href="/projects" className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline">
                View all {sorted.length} jobs on Jobs &amp; Labour →
              </Link>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
