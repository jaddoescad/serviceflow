import { dayKey } from "@/lib/format";

/** Relative or custom date filters for lists (created, last updated, stage
 * entered), compared as Ottawa calendar days. Client-safe. */
export const DATE_FILTER_PRESETS = [
  ["today", "Today"],
  ["7d", "Last 7 days"],
  ["14d", "Last 14 days"],
  ["30d", "Last 30 days"],
  ["month", "This month"],
  ["custom", "Custom"],
] as const;

export type DatePreset = (typeof DATE_FILTER_PRESETS)[number][0];
export type DateFilter = { preset: DatePreset; from?: string; to?: string } | null;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// One formatter for every comparison; boards filter thousands of timestamps.
const ottawaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" });

export function isDatePreset(value: unknown): value is DatePreset {
  return DATE_FILTER_PRESETS.some(([key]) => key === value);
}

/** `key` moved by `days` calendar days. */
export function addDays(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A stored or URL value as a DateFilter; anything unrecognised is no filter. */
export function parseDateFilter(raw: unknown): DateFilter {
  if (!raw || typeof raw !== "object") return null;
  const { preset, from, to } = raw as Record<string, unknown>;
  if (!isDatePreset(preset)) return null;
  if (preset !== "custom") return { preset };
  const start = typeof from === "string" && DAY.test(from) ? from : undefined;
  const end = typeof to === "string" && DAY.test(to) ? to : undefined;
  return start || end ? { preset, from: start, to: end } : null;
}

/** Inclusive first and last day; null ends are open. */
export function dateFilterBounds(filter: DateFilter, today = dayKey(new Date())): { from: string | null; to: string | null } {
  if (!filter) return { from: null, to: null };
  switch (filter.preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "14d":
      return { from: addDays(today, -13), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "custom":
      return { from: filter.from ?? null, to: filter.to ?? null };
  }
}

/** Whether a timestamp falls inside the filter's days. No filter matches all. */
export function inDateFilter(value: string | null, filter: DateFilter, today?: string): boolean {
  if (!filter) return true;
  if (!value) return false;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return false;
  const day = ottawaDay.format(time);
  const { from, to } = dateFilterBounds(filter, today);
  return (!from || day >= from) && (!to || day <= to);
}

const shortDay = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

export function describeDateFilter(filter: DateFilter): string {
  if (!filter) return "Any time";
  if (filter.preset !== "custom") return DATE_FILTER_PRESETS.find(([key]) => key === filter.preset)![1];
  if (filter.from && filter.to) return `${shortDay(filter.from)} – ${shortDay(filter.to)}`;
  return filter.from ? `Since ${shortDay(filter.from)}` : `Until ${shortDay(filter.to!)}`;
}
