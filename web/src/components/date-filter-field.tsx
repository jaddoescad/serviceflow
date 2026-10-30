"use client";

import { DATE_FILTER_PRESETS, addDays, isDatePreset, type DateFilter } from "@/lib/date-filter";
import { dayKey } from "@/lib/format";
import { Input, Select } from "./ui";

/** Preset select for a date filter; Custom adds from/to day inputs. */
export function DateFilterField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DateFilter;
  onChange: (value: DateFilter) => void;
}) {
  const today = dayKey(new Date());
  return (
    <div className="space-y-1.5">
      <Select
        aria-label={label}
        value={value?.preset ?? ""}
        onChange={(event) => {
          const preset = event.target.value;
          if (!isDatePreset(preset)) onChange(null);
          else if (preset === "custom") onChange({ preset, from: addDays(today, -29), to: today });
          else onChange({ preset });
        }}
        className="w-full"
      >
        <option value="">Any time</option>
        {DATE_FILTER_PRESETS.map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </Select>
      {value?.preset === "custom" ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label={`${label} from`}
            value={value.from ?? ""}
            max={value.to}
            onChange={(event) => onChange({ ...value, from: event.target.value || undefined })}
          />
          <span className="text-xs text-[var(--color-faint)]">to</span>
          <Input
            type="date"
            aria-label={`${label} to`}
            value={value.to ?? ""}
            min={value.from}
            onChange={(event) => onChange({ ...value, to: event.target.value || undefined })}
          />
        </div>
      ) : null}
    </div>
  );
}
