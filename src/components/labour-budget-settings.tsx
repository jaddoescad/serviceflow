"use client";

import { useState, useTransition } from "react";
import {
  saveLabourBudgetSettings,
  type LabourBudgetSettings,
} from "@/lib/actions/settings";
import { fmtHoursDecimal, fmtMoney } from "@/lib/format";
import { Button, Card, CardHeader, Field, Input } from "./ui";

const EXAMPLE_JOB_AMOUNT = 10_000;

function NumberField({
  label,
  hint,
  prefix,
  suffix,
  value,
  step,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  prefix?: string;
  suffix: string;
  value: string;
  step: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <div className="relative w-32">
          {prefix ? (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]">
              {prefix}
            </span>
          ) : null}
          <Input
            type="number"
            inputMode="decimal"
            step={step}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className={prefix ? "pl-7 tabular-nums" : "tabular-nums"}
          />
        </div>
        <span className="text-sm text-[var(--color-muted)]">{suffix}</span>
      </div>
      <span className="mt-1 block text-xs text-[var(--color-muted)]">{hint}</span>
    </Field>
  );
}

function parsed(value: string, min: number, max: number): number | null {
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) && number >= min && number <= max
    ? number
    : null;
}

export function LabourBudgetSettingsForm({
  settings,
}: {
  settings: LabourBudgetSettings;
}) {
  const [saved, setSavedSettings] = useState(settings);
  const [rate, setRate] = useState(settings.hourlyRate.toFixed(2));
  const [crewPercent, setCrewPercent] = useState(String(settings.crewHoursPercent));
  const [targetPercent, setTargetPercent] = useState(String(settings.costTargetPercent));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const hourlyRate = parsed(rate, 1, 500);
  const crewHoursPercent = parsed(crewPercent, 1, 100);
  const costTargetPercent = parsed(targetPercent, 1, 100);
  const valid = hourlyRate != null && crewHoursPercent != null && costTargetPercent != null;
  const changed =
    valid &&
    (Math.round(hourlyRate * 100) !== Math.round(saved.hourlyRate * 100) ||
      crewHoursPercent !== saved.crewHoursPercent ||
      costTargetPercent !== saved.costTargetPercent);
  const disabled = !settings.canEdit || pending;

  function edit(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      setMessage("");
      setError("");
    };
  }

  function save() {
    if (!valid) return;
    startTransition(async () => {
      const result = await saveLabourBudgetSettings({
        hourlyRate,
        crewHoursPercent,
        costTargetPercent,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedSettings(result.settings);
      setMessage("Saved. Jobs created from now on use these numbers.");
    });
  }

  const crewBudget = crewHoursPercent != null ? (EXAMPLE_JOB_AMOUNT * crewHoursPercent) / 100 : null;
  const targetCost = costTargetPercent != null ? (EXAMPLE_JOB_AMOUNT * costTargetPercent) / 100 : null;

  return (
    <Card>
      <CardHeader
        title="Labour budget"
        subtitle="Changes apply to new jobs only. Existing jobs keep the numbers they were created with."
      />
      <div className="space-y-5 px-5 py-5">
        <NumberField
          label="Standard hourly rate"
          hint="What an average crew hour costs you. Turns the crew budget into hours."
          prefix="$"
          suffix="per hour"
          step={0.5}
          value={rate}
          disabled={disabled}
          onChange={edit(setRate)}
        />
        <NumberField
          label="Crew hours budget"
          hint="Share of the job amount the crew's hours are budgeted from."
          suffix="% of job amount"
          step={0.5}
          value={crewPercent}
          disabled={disabled}
          onChange={edit(setCrewPercent)}
        />
        <NumberField
          label="Labour cost target"
          hint="Labour cost above this share of the job amount is flagged as over budget."
          suffix="% of job amount"
          step={0.5}
          value={targetPercent}
          disabled={disabled}
          onChange={edit(setTargetPercent)}
        />

        <div className="rounded-lg bg-[var(--color-surface-2)] px-4 py-3 text-sm">
          <div className="text-xs font-medium text-[var(--color-muted)]">
            Example: a {fmtMoney(EXAMPLE_JOB_AMOUNT)} job
          </div>
          <div className="mt-1">
            Crew budget {fmtMoney(crewBudget)} ÷ {hourlyRate != null ? `$${hourlyRate.toFixed(2)}` : "—"} ={" "}
            <span className="font-semibold tabular-nums text-[var(--color-heading)]">
              {crewBudget != null && hourlyRate != null
                ? `${fmtHoursDecimal(crewBudget / hourlyRate)} crew hours`
                : "—"}
            </span>
          </div>
          <div className="mt-0.5">
            Flagged when labour cost passes{" "}
            <span className="font-semibold tabular-nums text-[var(--color-heading)]">
              {fmtMoney(targetCost)}
            </span>
          </div>
        </div>

        {settings.canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={pending || !valid || !changed}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {error ? (
              <span role="alert" className="text-sm text-[var(--color-bad)]">
                {error}
              </span>
            ) : !valid ? (
              <span className="text-sm text-[var(--color-bad)]">
                Rate must be $1–$500 and percentages 1–100.
              </span>
            ) : message ? (
              <span role="status" className="text-sm text-[var(--color-good)]">
                {message}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">Only admins can change these.</p>
        )}
      </div>
    </Card>
  );
}
