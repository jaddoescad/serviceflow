"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveLabourBudgetRate,
  type LabourBudgetSettings,
} from "@/lib/actions/settings";
import { fmtHoursDecimal, fmtMoney } from "@/lib/format";
import { Button, Card, CardHeader, Field, Input } from "./ui";

const EXAMPLE_JOB_AMOUNT = 10_000;

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function LabourBudgetSettingsForm({
  settings,
}: {
  settings: LabourBudgetSettings;
}) {
  const router = useRouter();
  const [rate, setRate] = useState(settings.hourlyRate.toFixed(2));
  const [recalculate, setRecalculate] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, startTransition] = useTransition();

  const hourlyRate = Number(rate);
  const valid = rate.trim() !== "" && Number.isFinite(hourlyRate) && hourlyRate >= 1 && hourlyRate <= 500;
  const changed = valid && Math.round(hourlyRate * 100) !== Math.round(settings.hourlyRate * 100);
  const exampleBudget = (EXAMPLE_JOB_AMOUNT * settings.allocationPercent) / 100;

  function save() {
    setError("");
    setSaved("");
    startTransition(async () => {
      const result = await saveLabourBudgetRate({
        hourlyRate,
        recalculateOpenJobs: recalculate,
      });
      if (!result.ok) {
        setError(result.error ?? "Could not save the hourly rate.");
        return;
      }
      setRecalculate(false);
      setSaved(
        `Saved. New jobs use $${hourlyRate.toFixed(2)}/hour.` +
          (result.recalculatedJobs
            ? ` Recalculated ${plural(result.recalculatedJobs, "open job")}.`
            : ""),
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader
        title="Labour budget"
        subtitle="How each job's labour budget turns into crew hours."
      />
      <div className="space-y-5 px-5 py-5">
        <Field label="Standard hourly rate">
          <div className="flex items-center gap-2">
            <div className="relative w-40">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]">
                $
              </span>
              <Input
                type="number"
                inputMode="decimal"
                min={1}
                max={500}
                step={0.5}
                value={rate}
                disabled={!settings.canEdit || pending}
                onChange={(event) => {
                  setRate(event.target.value);
                  setSaved("");
                }}
                className="pl-7 tabular-nums"
              />
            </div>
            <span className="text-sm text-[var(--color-muted)]">per hour</span>
          </div>
        </Field>

        <p className="text-sm text-[var(--color-muted)]">
          Crew hours = job amount × {settings.allocationPercent}% labour budget ÷
          this rate. Use what an average crew hour costs you.
        </p>

        <div className="rounded-lg bg-[var(--color-surface-2)] px-4 py-3 text-sm">
          <span className="text-[var(--color-muted)]">Example: </span>
          {fmtMoney(EXAMPLE_JOB_AMOUNT)} job → {fmtMoney(exampleBudget)} labour budget →{" "}
          <span className="font-semibold tabular-nums text-[var(--color-heading)]">
            {valid ? `${fmtHoursDecimal(exampleBudget / hourlyRate)} crew hours` : "—"}
          </span>
        </div>

        {settings.canEdit ? (
          <>
            {settings.openFormulaJobs > 0 ? (
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={recalculate}
                  disabled={pending}
                  onChange={(event) => setRecalculate(event.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  Also recalculate {plural(settings.openFormulaJobs, "open job")} that
                  use the standard formula
                  <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                    Otherwise the new rate applies to new jobs and to a job the next
                    time its amount changes. Budgets set by hand or published from the
                    calculator, closed jobs
                    {settings.lockedFormulaJobs > 0
                      ? `, and ${plural(settings.lockedFormulaJobs, "job")} under the historical accounting lock`
                      : ""}{" "}
                    are never changed.
                  </span>
                </span>
              </label>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={save} disabled={pending || !valid || (!changed && !recalculate)}>
                {pending ? "Saving…" : "Save"}
              </Button>
              {error ? (
                <span role="alert" className="text-sm text-[var(--color-bad)]">
                  {error}
                </span>
              ) : null}
              {saved ? (
                <span role="status" className="text-sm text-[var(--color-good)]">
                  {saved}
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">
            Only admins can change this.
          </p>
        )}
      </div>
    </Card>
  );
}
