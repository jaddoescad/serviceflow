import type { ProjectDetail, ProjectRollup } from "@/lib/metrics";
import { fmtDate, fmtHours, fmtMoney, fmtTime } from "@/lib/format";
import { Card, CardHeader, cn } from "@/components/ui";

type Tone = "good" | "warn" | "bad";

const toneText: Record<Tone, string> = {
  good: "text-[var(--color-good)]",
  warn: "text-[var(--color-warn)]",
  bad: "text-[var(--color-bad)]",
};

const toneFill: Record<Tone, string> = {
  good: "bg-[var(--color-good)]",
  warn: "bg-[var(--color-warn)]",
  bad: "bg-[var(--color-bad)]",
};

function budgetTone(used: number, budget: number): Tone {
  if (used > budget) return "bad";
  if (used >= budget * 0.85) return "warn";
  return "good";
}

function BudgetBar({ used, budget, tone }: { used: number; budget: number; tone: Tone }) {
  const over = used > budget;
  const scale = Math.max(used, budget);
  const withinWidth = scale > 0 ? (Math.min(used, budget) / scale) * 100 : 0;
  const budgetMark = scale > 0 ? (budget / scale) * 100 : 0;
  return (
    <div className="relative h-3 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
      <div
        className={cn("absolute inset-y-0 left-0", over ? "bg-[var(--color-muted)]" : toneFill[tone])}
        style={{ width: `${withinWidth}%` }}
      />
      {over ? (
        <div
          className="absolute inset-y-0 bg-[var(--color-bad)]"
          style={{ left: `${budgetMark}%`, right: 0 }}
        />
      ) : null}
    </div>
  );
}

export function ProjectOverviewPanel({
  project,
  detail,
}: {
  project: ProjectRollup;
  detail?: ProjectDetail;
}) {
  const used = project.loggedHours;
  const budget = project.budgetedHours && project.budgetedHours > 0 ? project.budgetedHours : null;
  const rate = project.hourlyRate;
  const amount = project.amountBeforeTax;
  const budgetDollars = budget != null && rate != null ? budget * rate : null;
  const budgetShare =
    budgetDollars != null && amount != null && amount > 0
      ? Math.round((budgetDollars / amount) * 100)
      : null;
  const crew = [...(detail?.crew ?? [])].sort((a, b) => b.hours - a.hours);
  const entries = detail?.entries ?? [];
  const tone = budget != null ? budgetTone(used, budget) : null;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        {budget == null || tone == null ? (
          <>
            <p className="text-lg font-semibold text-[var(--color-heading)]">No labour budget</p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {amount == null
                ? "This job has no job amount, so no budget hours can be worked out."
                : "Budget hours have not been set for this job."}{" "}
              {fmtHours(used)} recorded.
            </p>
          </>
        ) : (
          <>
            <p className={cn("text-sm font-semibold", toneText[tone])}>
              {tone === "bad" ? "Over budget" : tone === "warn" ? "Almost at budget" : "Under budget"}
            </p>
            <p className="mt-1 font-display text-3xl font-semibold text-[var(--color-heading)]">
              {used > budget ? `${fmtHours(used - budget)} over` : `${fmtHours(budget - used)} left`}
            </p>
            <div className="mt-4">
              <BudgetBar used={used} budget={budget} tone={tone} />
            </div>
            <div className="mt-2 flex justify-between gap-4 text-sm">
              <span>
                <span className="font-semibold tabular-nums">{fmtHours(used)}</span> used
              </span>
              <span>
                <span className="font-semibold tabular-nums">{fmtHours(budget)}</span> budget ·{" "}
                {Math.round((used / budget) * 100)}%
              </span>
            </div>
            {budgetDollars != null && rate != null ? (
              <p className="mt-4 border-t border-[var(--color-border)] pt-4 text-sm text-[var(--color-muted)]">
                {budgetShare != null && amount != null
                  ? `${budgetShare}% of the ${fmtMoney(amount)} job (before HST) = `
                  : ""}
                {fmtMoney(budgetDollars)} labour ÷ {fmtMoney(rate)}/h = {fmtHours(budget)}
              </p>
            ) : null}
          </>
        )}
      </Card>

      {crew.length ? (
        <Card>
          <CardHeader title="Hours by painter" />
          <ul className="divide-y divide-[var(--color-border)]">
            {crew.map((member) => (
              <li key={member.crewId} className="px-5 py-3">
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="font-medium text-[var(--color-heading)]">{member.name}</span>
                  <span className="tabular-nums">
                    <span className="font-semibold">{fmtHours(member.hours)}</span>
                    {budget != null ? (
                      <span className="text-[var(--color-muted)]">
                        {" "}· {Math.round((member.hours / budget) * 100)}% of budget
                      </span>
                    ) : null}
                  </span>
                </div>
                {budget != null ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div
                      className="h-full bg-[var(--color-brand)]"
                      style={{ width: `${Math.min(100, (member.hours / budget) * 100)}%` }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {entries.length ? (
        <Card>
          <CardHeader title="Time log" />
          <ul className="divide-y divide-[var(--color-border)]">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--color-heading)]">{entry.userName}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                    {fmtDate(entry.startedAt)} · {fmtTime(entry.startedAt)} –{" "}
                    {entry.endedAt ? fmtTime(entry.endedAt) : "Clocked in"}
                  </p>
                </div>
                <span className="whitespace-nowrap font-semibold tabular-nums">{fmtHours(entry.hours)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
