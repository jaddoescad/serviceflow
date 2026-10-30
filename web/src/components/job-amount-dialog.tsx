"use client";
import { useState, useRef, useEffect } from "react";
import { Field, Input, Button } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { LABOUR_MIN_PERCENT, type ProjectRollup } from "@/lib/metrics";
export function AmountDialog({
  project,
  pending,
  onClose,
  onSave,
}: {
  project: ProjectRollup;
  pending: boolean;
  onClose: () => void;
  onSave: (input: { projectId: string; amountBeforeTax: number | null }) => void;
}) {
  const [amount, setAmount] = useState(project.amountBeforeTax?.toString() ?? "");
  const dialogRef = useRef<HTMLDivElement>(null);
  const numericAmount = amount.trim() === "" ? null : Number(amount);
  const crewHoursPercent = project.crewHoursPercent;
  const allowanceLow = numericAmount != null
    ? numericAmount * (Math.min(LABOUR_MIN_PERCENT, crewHoursPercent) / 100)
    : null;
  const allowanceHigh = numericAmount != null ? numericAmount * (crewHoursPercent / 100) : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose, pending]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-amount-dialog-title"
        aria-describedby="job-amount-dialog-description"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)] outline-none"
      >
        <h3
          id="job-amount-dialog-title"
          className="truncate border-b border-[var(--color-border)] px-5 py-3.5 text-[15px] font-semibold text-[var(--color-heading)]"
        >
          Job amount · {project.name}
        </h3>
        <div className="p-5">
          <p id="job-amount-dialog-description" className="mb-4 text-[13px] text-[var(--color-muted)]">
            Enter the job amount before HST. The dashboard uses exactly what you enter.
          </p>
          <Field label="Job amount before HST (CAD)">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 5,650.00"
            />
          </Field>
          <dl className="mt-4 rounded-[var(--radius)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--color-muted)]">Entered job amount</dt>
              <dd className="font-semibold tabular-nums text-[var(--color-heading)]">{fmtMoney(numericAmount)}</dd>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <dt className="text-[var(--color-muted)]">
                {Math.min(LABOUR_MIN_PERCENT, crewHoursPercent)}–{crewHoursPercent}% labour allowance
              </dt>
              <dd className="font-semibold tabular-nums text-[var(--color-heading)]">
                {allowanceLow != null && allowanceHigh != null
                  ? `${fmtMoney(allowanceLow)}–${fmtMoney(allowanceHigh)}`
                  : "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            If a change order changes the total, update this amount once and the labour figures recalculate immediately.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSave({
                projectId: project.projectId,
                amountBeforeTax: amount.trim() === "" ? null : Number(amount),
              })
            }
          >
            {pending ? "Saving…" : "Save amount"}
          </Button>
        </div>
      </div>
    </div>
  );
}
