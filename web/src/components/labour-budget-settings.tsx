"use client";

import { useState, useTransition } from "react";
import {
  saveLabourBudgetSettings,
  type LabourBudgetSettings,
} from "@/lib/actions/settings";
import { fmtHoursDecimal, fmtMoney } from "@/lib/format";
import { Button, Field, Input } from "./ui";
import { SaveStatus, SettingsSection } from "./settings/settings-section";

const EXAMPLE_JOB_AMOUNT = 10_000;

function NumberField({
  label,
  hint,
  prefix,
  suffix,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  prefix?: string;
  suffix: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]">
            {prefix}
          </span>
        ) : null}
        <Input
          type="number"
          inputMode="decimal"
          step={0.5}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={`${prefix ? "pl-7" : ""} pr-16 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-muted)]">
          {suffix}
        </span>
      </div>
      <span className="mt-1.5 block text-xs leading-relaxed text-[var(--color-muted)]">{hint}</span>
    </Field>
  );
}

function PreviewFigure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-[var(--color-surface)] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="mt-1 font-display text-lg font-semibold tabular-nums text-[var(--color-heading)]">{value}</div>
      <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">{hint}</div>
    </div>
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
    <SettingsSection
      id="labour"
      title="Labour budget"
      description="How each job's amount becomes a crew-hour budget, and when labour cost is flagged. Changes apply to new jobs only; existing jobs keep the numbers they were created with."
      footer={
        settings.canEdit ? (
          <>
            <SaveStatus
              error={error || (!valid ? "Rate must be $1–$500 and percentages 1–100." : "")}
              message={message}
              hint="Applies to jobs created after you save."
            />
            <Button className="ml-auto" onClick={save} disabled={pending || !valid || !changed}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </>
        ) : (
          <span>Only owners and admins can change labour settings.</span>
        )
      }
    >
      <div className="grid gap-5 sm:grid-cols-3">
        <NumberField
          label="Standard hourly rate"
          hint="Each painter's hour counts as their pay ÷ this rate."
          prefix="$"
          suffix="/ hour"
          value={rate}
          disabled={disabled}
          onChange={edit(setRate)}
        />
        <NumberField
          label="Crew hours budget"
          hint="Share of the job amount crew hours come from."
          suffix="% of job"
          value={crewPercent}
          disabled={disabled}
          onChange={edit(setCrewPercent)}
        />
        <NumberField
          label="Labour cost target"
          hint="Labour cost above this is flagged as over budget."
          suffix="% of job"
          value={targetPercent}
          disabled={disabled}
          onChange={edit(setTargetPercent)}
        />
      </div>

      <div className="mt-6">
        <div className="text-xs font-medium text-[var(--color-muted)]">
          Preview for a {fmtMoney(EXAMPLE_JOB_AMOUNT)} job
        </div>
        <div className="mt-2 grid gap-px overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-3">
          <PreviewFigure
            label="Crew budget"
            value={fmtMoney(crewBudget)}
            hint={crewHoursPercent != null ? `${crewHoursPercent}% of the job` : "—"}
          />
          <PreviewFigure
            label="Crew hours"
            value={
              crewBudget != null && hourlyRate != null ? `${fmtHoursDecimal(crewBudget / hourlyRate)} h` : "—"
            }
            hint={hourlyRate != null ? `at $${hourlyRate.toFixed(2)} an hour` : "—"}
          />
          <PreviewFigure
            label="Flagged above"
            value={fmtMoney(targetCost)}
            hint="of labour cost"
          />
        </div>
      </div>
    </SettingsSection>
  );
}
