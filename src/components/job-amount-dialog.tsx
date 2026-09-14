"use client";
import { useState, useRef, useEffect } from "react";
import { Card, Field, Input, Button } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { LABOUR_MIN_PERCENT, LABOUR_MAX_PERCENT, type ProjectRollup } from "@/lib/metrics";
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
  const allowanceLow = numericAmount != null ? numericAmount * (LABOUR_MIN_PERCENT / 100) : null;
  const allowanceHigh = numericAmount != null ? numericAmount * (LABOUR_MAX_PERCENT / 100) : null;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="job-amount-dialog-title"
          aria-describedby="job-amount-dialog-description"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className="outline-none"
        >
          <h3 id="job-amount-dialog-title" className="text-sm font-semibold">
            Job amount · {project.name}
          </h3>
          <p id="job-amount-dialog-description" className="mb-4 text-xs text-[var(--color-muted)]">
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

          <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-[var(--color-muted)]">Entered job amount</span>
              <span className="font-semibold tabular-nums">{fmtMoney(numericAmount)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-[var(--color-muted)]">35–37% labour allowance</span>
              <span className="font-semibold tabular-nums">
                {allowanceLow != null && allowanceHigh != null
                  ? `${fmtMoney(allowanceLow)}–${fmtMoney(allowanceHigh)}`
                  : "—"}
              </span>
            </div>
            <p className="mt-3 text-[11px] leading-4 text-[var(--color-muted)]">
              If a change order changes the total, update this amount once and the labour figures recalculate immediately.
            </p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
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
      </Card>
    </div>
  );
}
