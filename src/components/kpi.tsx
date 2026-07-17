import * as React from "react";
import { Card, cn } from "@/components/ui";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-heading)]">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-[var(--color-muted)]">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function Kpi({
  label,
  value,
  hint,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: { value: number; suffix?: string } | null;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneColor = {
    neutral: "text-[var(--color-heading)]",
    good: "text-[var(--color-good)]",
    warn: "text-[var(--color-warn)]",
    bad: "text-[var(--color-bad)]",
  }[tone];

  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div className={cn("font-display mt-2 text-2xl font-semibold tabular-nums", toneColor)}>{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-muted)]">
        {delta ? (
          <span
            className={cn(
              "font-medium",
              delta.value > 0 ? "text-[var(--color-good)]" : delta.value < 0 ? "text-[var(--color-bad)]" : "",
            )}
          >
            {delta.value > 0 ? "▲" : delta.value < 0 ? "▼" : "•"} {Math.abs(delta.value)}
            {delta.suffix ?? "%"}
          </span>
        ) : null}
        {hint ? <span>{hint}</span> : null}
      </div>
    </Card>
  );
}
