"use client";

import * as React from "react";
import { cn } from "@/components/ui";

/** Compact inline number input used on cards: label above, tight width. */
export function NumField({
  label,
  value,
  onChange,
  width = "w-16",
  suffix,
  step,
  autoFocus,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  width?: string;
  suffix?: string;
  step?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[var(--color-muted)]">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          name={label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
          min="0"
          step={step ?? "any"}
          autoFocus={autoFocus}
          value={value ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(null);
            const parsed = Number(raw);
            onChange(Number.isFinite(parsed) ? parsed : null);
          }}
          onFocus={(e) => e.target.select()}
          className={cn(
            "rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm tabular-nums text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]",
            width,
          )}
        />
        {suffix ? <span className="text-xs text-[var(--color-muted)]">{suffix}</span> : null}
      </span>
    </label>
  );
}

/** Pill toggle for included scope (walls, ceiling, trim…). */
export function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        on
          ? "border-transparent bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
          : "border-[var(--color-border)] bg-transparent text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
      )}
    >
      <span
        aria-hidden
        className={cn("text-[10px] leading-none", on ? "" : "opacity-50")}
      >
        {on ? "✓" : "+"}
      </span>
      {children}
    </button>
  );
}

/** Standalone − / + pill shown next to the Trim chip (coats can't nest inside the chip button). */
export function CoatsStepper({
  value,
  onChange,
  min = 1,
  max = 3,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand-soft)] px-2 py-1 text-xs font-medium text-[var(--color-brand-strong)]">
      <button
        type="button"
        aria-label="Fewer trim coats"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="grid h-4 w-4 place-items-center rounded-full bg-[var(--color-surface)] text-[10px] leading-none shadow-sm"
      >
        −
      </button>
      <span className="tabular-nums">
        {value} coat{value === 1 ? "" : "s"}
      </span>
      <button
        type="button"
        aria-label="More trim coats"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="grid h-4 w-4 place-items-center rounded-full bg-[var(--color-surface)] text-[10px] leading-none shadow-sm"
      >
        +
      </button>
    </span>
  );
}

/** Two-step delete: ✕ arms it, a red "Delete?" confirms; disarms after 3s. */
export function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);

  if (armed) {
    return (
      <button
        type="button"
        aria-label={`Confirm: ${label}`}
        onClick={onConfirm}
        className="rounded-lg bg-[var(--color-bad-soft)] px-2 py-1 text-xs font-medium text-[var(--color-bad)]"
      >
        Delete?
      </button>
    );
  }
  return (
    <IconButton label={label} onClick={() => setArmed(true)} danger>
      ✕
    </IconButton>
  );
}

/** Ghost icon button (delete, duplicate…). */
export function IconButton({
  label,
  onClick,
  children,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-lg text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)]",
        danger ? "hover:text-[var(--color-bad)]" : "hover:text-[var(--color-text)]",
      )}
    >
      {children}
    </button>
  );
}

export function fmtMoneyExact(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export function fmtHoursShort(hours: number): string {
  return `${hours.toFixed(1)} h`;
}
