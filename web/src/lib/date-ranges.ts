/** Date ranges for metrics and reports, as YYYY-MM-DD in the browser's local calendar. */
export const RANGE_PRESETS = [
  ["today", "Today"],
  ["week", "Week"],
  ["last_week", "Last Wk"],
  ["month", "Month"],
  ["last_month", "Last Mo"],
  ["ytd", "YTD"],
  ["all", "All"],
] as const;

type RangePreset = (typeof RANGE_PRESETS)[number][0];

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function presetRange(preset: RangePreset, now = new Date()): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());
  switch (preset) {
    case "today":
      return { from: iso(today), to: iso(today) };
    case "week":
      return { from: iso(sunday), to: iso(today) };
    case "last_week": {
      const start = new Date(sunday);
      start.setDate(sunday.getDate() - 7);
      const end = new Date(sunday);
      end.setDate(sunday.getDate() - 1);
      return { from: iso(start), to: iso(end) };
    }
    case "month":
      return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
    case "last_month":
      return {
        from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: iso(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    case "ytd":
      return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) };
    case "all":
      return { from: "2000-01-01", to: iso(today) };
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A custom from/to wins over a preset; the default is this month. */
export function resolveRange(params: { preset?: string; from?: string; to?: string }) {
  if (params.from && params.to && DATE.test(params.from) && DATE.test(params.to) && params.from <= params.to) {
    return { preset: null, from: params.from, to: params.to };
  }
  const preset = RANGE_PRESETS.find(([key]) => key === params.preset)?.[0] ?? "month";
  return { preset, ...presetRange(preset) };
}
