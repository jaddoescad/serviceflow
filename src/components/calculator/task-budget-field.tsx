"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import type { LabourBudgetTaskSelection } from "@/lib/actions/calculator";

export function LabourTaskBudgetField({
  task,
  disabled,
  saving,
  onChange,
}: {
  task: LabourBudgetTaskSelection;
  disabled: boolean;
  saving: boolean;
  onChange: (taskId: string, hours: number | null) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(task.budgetedHours.toFixed(2));
  const isManual = task.manualBudgetedHours !== null;
  const parsed = draft.trim() === "" ? Number.NaN : Number(draft);
  const isValid = Number.isFinite(parsed) && parsed >= 0;
  const isChanged = isValid && Math.abs(parsed - task.budgetedHours) >= 0.005;
  const isDirty = !isValid || isChanged;

  useEffect(() => {
    setDraft(task.budgetedHours.toFixed(2));
  }, [task.budgetedHours]);

  return (
    <form
      className="mt-3 border-t border-[var(--color-border)] pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (isValid && isChanged && !disabled) void onChange(task.id, parsed);
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Painter budget
            <span className={isManual ? "text-[var(--color-warn)]" : "font-normal normal-case tracking-normal"}>
              {isManual ? "Manual" : "Calculated"}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.25"
              value={draft}
              name={`task-budget-${task.id}`}
              aria-label={`${task.title} painter budget hours`}
              disabled={disabled}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => event.target.select()}
              className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm tabular-nums text-[var(--color-text)] outline-none focus:border-[var(--color-brand)] disabled:opacity-60"
            />
            <span className="text-xs text-[var(--color-muted)]">h</span>
          </span>
        </label>
        <Button type="submit" variant="subtle" size="sm" disabled={!isValid || !isChanged || disabled}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {isDirty ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => setDraft(task.budgetedHours.toFixed(2))}
          >
            Reset
          </Button>
        ) : null}
        {isManual ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => void onChange(task.id, null)}
          >
            Use calculated
          </Button>
        ) : null}
        {isManual ? (
          <span className="pb-1.5 text-[10px] text-[var(--color-muted)]">
            Calculated value kept: {task.calculatedHours.toFixed(2)} h
          </span>
        ) : null}
      </div>
    </form>
  );
}
