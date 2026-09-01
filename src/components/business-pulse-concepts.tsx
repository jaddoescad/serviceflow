"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { ClaudeConcept1 } from "@/components/metrics-concepts/claude-concept-1";
import { fmtDateTime } from "@/lib/format";
import type { BusinessPulse } from "@/lib/business-pulse-metrics";
import {
  METRICS_PRESETS,
  type MetricsPeriodSelection,
  type MetricsPreset,
} from "@/lib/metrics-period";
import { prepareMetricsConceptPulse } from "@/components/metrics-concepts/metrics-concept-data";

function shortDate(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function periodLabel(period: { start: string; end: string }): string {
  return period.start === period.end
    ? shortDate(period.start)
    : `${shortDate(period.start)}–${shortDate(period.end)}`;
}

function PeriodControl({ selection, asOf }: { selection: MetricsPeriodSelection; asOf: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showCustom, setShowCustom] = useState(selection.preset === "custom");
  const [start, setStart] = useState(selection.current.start);
  const [end, setEnd] = useState(selection.current.end);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const asOfDate = new Date(`${asOf}T12:00:00Z`);
  const monthOptions = Array.from({ length: asOfDate.getUTCMonth() + 1 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    return {
      id: `${asOfDate.getUTCFullYear()}-${month}`,
      label: new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" })
        .format(new Date(Date.UTC(asOfDate.getUTCFullYear(), index, 1, 12))),
    };
  });

  function goToPreset(preset: MetricsPreset) {
    if (preset === "custom") {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    startTransition(() => router.push(`/metrics?range=${preset}`));
  }

  function goToMonth(month: string) {
    setShowCustom(false);
    startTransition(() => router.push(`/metrics?range=month&month=${month}`));
  }

  function applyCustom() {
    const selectedStart = startRef.current?.value ?? start;
    const selectedEnd = endRef.current?.value ?? end;
    if (!selectedStart || !selectedEnd || selectedStart > selectedEnd || selectedEnd > asOf) return;
    startTransition(() => router.push(`/metrics?range=custom&start=${selectedStart}&end=${selectedEnd}`));
  }

  return (
    <section
      aria-label="Choose reporting period"
      aria-busy={pending}
      className="rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex max-w-full items-center gap-1 overflow-x-auto pb-1" aria-label="Choose a month">
          <span className="mr-1 shrink-0 text-xs font-semibold text-slate-900">{asOfDate.getUTCFullYear()}</span>
          {monthOptions.map((month) => {
            const active = selection.current.start.startsWith(month.id)
              && (selection.preset === "month" || selection.preset === "this_month");
            return (
              <button
                key={month.id}
                type="button"
                aria-pressed={active}
                onClick={() => goToMonth(month.id)}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
                  active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:text-slate-900",
                )}
              >
                {month.label}
              </button>
            );
          })}
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto pb-1" aria-label="Date range presets">
          {METRICS_PRESETS.map((preset) => {
            const active = selection.preset === preset.id || (preset.id === "custom" && showCustom);
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => goToPreset(preset.id)}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium",
                  active
                    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 text-slate-500 hover:text-slate-900",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
      {showCustom ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            applyCustom();
          }}
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3"
        >
          <label className="text-xs text-slate-500">
            <span className="mb-1 block">From</span>
            <input
              ref={startRef}
              type="date"
              value={start}
              max={end}
              onChange={(event) => setStart(event.target.value)}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-slate-900"
            />
          </label>
          <label className="text-xs text-slate-500">
            <span className="mb-1 block">To</span>
            <input
              ref={endRef}
              type="date"
              value={end}
              min={start}
              max={asOf}
              onChange={(event) => setEnd(event.target.value)}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-slate-900"
            />
          </label>
          <button
            type="submit"
            disabled={pending || !start || !end || start > end}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Apply
          </button>
        </form>
      ) : null}
    </section>
  );
}

export function BusinessPulseBento({
  pulse,
  selection,
}: {
  pulse: BusinessPulse;
  selection: MetricsPeriodSelection;
}) {
  const conceptPulse = prepareMetricsConceptPulse(pulse);
  const oldestRefresh = [
    pulse.freshness.leads,
    pulse.freshness.proposals,
    pulse.freshness.meta,
    pulse.freshness.accounting,
    pulse.freshness.sales,
    pulse.freshness.setRate,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  return (
    <section aria-label="Business metrics" className="space-y-4">
      <PeriodControl selection={selection} asOf={pulse.asOf} />
      <p className="px-1 text-xs text-slate-500">
        {periodLabel(pulse.currentPeriod)} vs {periodLabel(pulse.previousPeriod)}
        {oldestRefresh ? ` · data through ${fmtDateTime(oldestRefresh)}` : ""}
      </p>
      <ClaudeConcept1 pulse={conceptPulse} />
    </section>
  );
}
