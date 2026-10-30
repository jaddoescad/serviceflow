import { RANGE_PRESETS } from "@/lib/date-ranges";
import { FilterPills } from "./table-ui";
import { Button, Input } from "./ui";

/** Preset links plus a custom range form; extra keeps other query params. */
export function RangePicker({
  path,
  preset,
  from,
  to,
  extra = {},
}: {
  path: string;
  preset: string | null;
  from: string;
  to: string;
  extra?: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterPills
        label="Date range"
        value={preset}
        options={RANGE_PRESETS.map(([key, label]) => ({
          value: key,
          label,
          href: `${path}?${new URLSearchParams({ ...extra, preset: key })}`,
        }))}
      />
      <form action={path} className="flex items-center gap-1.5">
        {Object.entries(extra).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <div className="w-36">
          <Input type="date" name="from" aria-label="From" defaultValue={from} />
        </div>
        <span className="text-xs text-[var(--color-faint)]">to</span>
        <div className="w-36">
          <Input type="date" name="to" aria-label="To" defaultValue={to} />
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>
    </div>
  );
}
