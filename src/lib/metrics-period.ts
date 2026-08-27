const DAY_MS = 86_400_000;

export type MetricsPreset =
  | "today"
  | "this_week"
  | "this_month"
  | "last_month"
  | "last_30_days"
  | "this_quarter"
  | "month"
  | "custom";

export type MetricsPeriod = { start: string; end: string };

export type MetricsPeriodSelection = {
  preset: MetricsPreset;
  current: MetricsPeriod;
  previous: MetricsPeriod;
};

export const METRICS_PRESETS: Array<{ id: MetricsPreset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "this_week", label: "This week" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "last_30_days", label: "Last 30 days" },
  { id: "this_quarter", label: "This quarter" },
  { id: "custom", label: "Custom" },
];

const METRICS_PRESET_IDS: MetricsPreset[] = [
  ...METRICS_PRESETS.map((item) => item.id),
  "month",
];

function date(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

function iso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  return iso(new Date(date(value).getTime() + days * DAY_MS));
}

function daysBetween(start: string, end: string): number {
  return Math.round((date(end).getTime() - date(start).getTime()) / DAY_MS);
}

function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function shiftMonths(value: string, months: number): string {
  const shifted = date(monthStart(value));
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  return iso(shifted);
}

function monthEnd(value: string): string {
  return addDays(shiftMonths(value, 1), -1);
}

function matchingElapsedPeriod(start: string, end: string, previousStart: string): MetricsPeriod {
  return {
    start: previousStart,
    end: [addDays(previousStart, daysBetween(start, end)), monthEnd(previousStart)].sort()[0]!,
  };
}

function precedingPeriod(current: MetricsPeriod): MetricsPeriod {
  const length = daysBetween(current.start, current.end) + 1;
  const end = addDays(current.start, -1);
  return { start: addDays(end, -(length - 1)), end };
}

function validIsoDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date(value).getTime()));
}

export function resolveMetricsPeriod(
  requestedPreset: string | undefined,
  today: string,
  customStart?: string,
  customEnd?: string,
  requestedMonth?: string,
): MetricsPeriodSelection {
  const preset = METRICS_PRESET_IDS.includes(requestedPreset as MetricsPreset)
    ? requestedPreset as MetricsPreset
    : "this_month";

  if (preset === "today") {
    return {
      preset,
      current: { start: today, end: today },
      previous: { start: addDays(today, -1), end: addDays(today, -1) },
    };
  }

  if (preset === "this_week") {
    const weekday = date(today).getUTCDay();
    const mondayOffset = weekday === 0 ? 6 : weekday - 1;
    const current = { start: addDays(today, -mondayOffset), end: today };
    return {
      preset,
      current,
      previous: { start: addDays(current.start, -7), end: addDays(current.end, -7) },
    };
  }

  if (preset === "last_month") {
    const currentStart = shiftMonths(today, -1);
    const previousStart = shiftMonths(today, -2);
    return {
      preset,
      current: { start: currentStart, end: monthEnd(currentStart) },
      previous: { start: previousStart, end: monthEnd(previousStart) },
    };
  }

  if (preset === "last_30_days") {
    const current = { start: addDays(today, -29), end: today };
    return { preset, current, previous: precedingPeriod(current) };
  }

  if (preset === "this_quarter") {
    const currentDate = date(today);
    const quarterMonth = Math.floor(currentDate.getUTCMonth() / 3) * 3;
    const currentStartDate = new Date(Date.UTC(currentDate.getUTCFullYear(), quarterMonth, 1, 12));
    const currentStart = iso(currentStartDate);
    const previousStartDate = new Date(currentStartDate);
    previousStartDate.setUTCMonth(previousStartDate.getUTCMonth() - 3);
    const previousStart = iso(previousStartDate);
    const previousQuarterEnd = addDays(currentStart, -1);
    return {
      preset,
      current: { start: currentStart, end: today },
      previous: {
        start: previousStart,
        end: [addDays(previousStart, daysBetween(currentStart, today)), previousQuarterEnd].sort()[0]!,
      },
    };
  }

  if (preset === "month" && /^\d{4}-\d{2}$/.test(requestedMonth ?? "")) {
    const selectedStart = `${requestedMonth}-01`;
    if (validIsoDate(selectedStart) && selectedStart <= today) {
      const isCurrentMonth = requestedMonth === today.slice(0, 7);
      const current = {
        start: selectedStart,
        end: isCurrentMonth ? today : monthEnd(selectedStart),
      };
      const previousStart = shiftMonths(selectedStart, -1);
      return {
        preset,
        current,
        previous: isCurrentMonth
          ? matchingElapsedPeriod(current.start, current.end, previousStart)
          : { start: previousStart, end: monthEnd(previousStart) },
      };
    }
  }

  if (
    preset === "custom" &&
    validIsoDate(customStart) &&
    validIsoDate(customEnd) &&
    customStart <= customEnd &&
    customEnd <= today
  ) {
    const current = { start: customStart, end: customEnd };
    return { preset, current, previous: precedingPeriod(current) };
  }

  const current = { start: monthStart(today), end: today };
  return {
    preset: "this_month",
    current,
    previous: matchingElapsedPeriod(current.start, current.end, shiftMonths(today, -1)),
  };
}
