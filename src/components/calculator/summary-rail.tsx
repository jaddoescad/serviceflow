"use client";

import { useEffect, useState } from "react";
import { Button, Card, Select } from "@/components/ui";
import type { DefaultCalculatorSelection } from "@/lib/actions/calculator";
import { fmtMoney } from "@/lib/format";
import {
  Adjustment,
  CATALOG_BY_ID,
  CalculatorTotals,
  PAINT_TIER_LABELS,
  QUOTE_STATUS_LABELS,
  Quote,
  priceExteriorLine,
  priceRoom,
} from "@/lib/calculator/engine";
import { IconButton } from "./bits";
import type { SyncStatus } from "./use-calculator";

const SYNC_LABELS: Record<SyncStatus, string> = {
  loading: "Loading…",
  synced: "Synced — autosaves to Supabase as you type.",
  saving: "Saving…",
  offline: "Offline — saved on this device only.",
};

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className={strong ? "font-medium text-[var(--color-text)]" : "text-[var(--color-muted)]"}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold text-[var(--color-heading)]" : ""}`}>{value}</span>
    </div>
  );
}

function buildCopyText(
  projectName: string,
  quote: Quote,
  totals: CalculatorTotals,
  labourBudgetHours = totals.hours,
): string {
  const lines: string[] = [];
  lines.push(`${projectName} — ${quote.name} (${QUOTE_STATUS_LABELS[quote.status]})`);
  if (totals.adjustmentAmount !== 0) {
    lines.push(`Subtotal (pre-HST): ${fmtMoney(totals.subtotal)}`);
    lines.push(`${quote.adjustment?.label || "Adjustment"}: ${fmtMoney(totals.adjustmentAmount)}`);
  }
  lines.push(`Client price (pre-HST): ${fmtMoney(totals.price)}`);
  lines.push(`HST (${Math.round(quote.rates.exterior.hst * 100)}%): ${fmtMoney(totals.hst)}`);
  lines.push(`Total incl. HST: ${fmtMoney(totals.totalWithHst)}`);
  lines.push(`Labour budget: ${labourBudgetHours.toFixed(2)} h`);

  if (quote.rooms.length > 0) {
    lines.push("", "Rooms — expected hours");
    for (const room of quote.rooms) {
      const p = priceRoom(room, quote.paintTier, quote.rates.interior);
      lines.push(`${room.name || "Room"} — ${p.hours.toFixed(2)}`);
    }
    lines.push(
      `Paint — ${PAINT_TIER_LABELS[quote.paintTier]} · Labour % — ${Math.round(quote.rates.interior.labourPercent * 100)}% · Hourly rate — $${quote.rates.interior.hourlyRate.toFixed(2)}`,
    );
  }

  if (quote.exterior.length > 0 || quote.washing !== "none") {
    lines.push("", "Exterior — hours");
    for (const line of quote.exterior) {
      const item = CATALOG_BY_ID[line.itemId];
      if (!item) continue;
      const p = priceExteriorLine(line, quote.rates.exterior);
      lines.push(`${item.label} — ${p.hours.toFixed(2)}`);
    }
    if (quote.washing !== "none") lines.push(`Pressure washing (${quote.washing === "big" ? "big job" : "minimum"})`);
    lines.push(`Crew-days (2 painters × 8 h) — ${totals.exterior.crewDays.toFixed(2)}`);
  }

  if (quote.notes.trim()) {
    lines.push("", `Notes: ${quote.notes.trim()}`);
  }

  return lines.join("\n");
}

function AdjustmentEditor({
  adjustment,
  onChange,
}: {
  adjustment: Adjustment;
  onChange: (adjustment: Adjustment | null) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5">
      <div className="flex items-center gap-1.5">
        <input
          value={adjustment.label}
          onChange={(e) => onChange({ ...adjustment, label: e.target.value })}
          name="adjustment-label"
          aria-label="Adjustment label"
          placeholder="Adjustment"
          className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
        />
        <IconButton label="Remove adjustment" onClick={() => onChange(null)} danger>
          ✕
        </IconButton>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <Select
          value={adjustment.mode}
          onChange={(e) => onChange({ ...adjustment, mode: e.target.value as Adjustment["mode"] })}
          name="adjustment-mode"
          aria-label="Adjustment type"
          className="!px-2 !py-1 text-xs"
        >
          <option value="amount">$</option>
          <option value="percent">%</option>
        </Select>
        <NumFieldSigned
          value={adjustment.value}
          onChange={(value) => onChange({ ...adjustment, value })}
          suffix={adjustment.mode === "percent" ? "%" : "$"}
        />
      </div>
      <p className="mt-1.5 text-[10px] leading-3 text-[var(--color-muted)]">
        Negative = discount. Hours are not affected.
      </p>
    </div>
  );
}

/** Like NumField but allows negative values (discounts). */
function NumFieldSigned({
  value,
  onChange,
  suffix,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  suffix: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        name="adjustment-value"
        aria-label="Adjustment value"
        step="any"
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(null);
          const parsed = Number(raw);
          onChange(Number.isFinite(parsed) ? parsed : null);
        }}
        onFocus={(e) => e.target.select()}
        placeholder="-150"
        className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm tabular-nums text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
      />
      <span className="text-xs text-[var(--color-muted)]">{suffix}</span>
    </span>
  );
}

export function SummaryRail({
  projectName,
  quote,
  totals,
  syncStatus,
  defaultCalculator,
  defaultCalculatorError,
  makingDefault,
  onMakeDefault,
  onEditRates,
  onSetAdjustment,
  onClear,
}: {
  projectName: string;
  quote: Quote;
  totals: CalculatorTotals;
  syncStatus: SyncStatus;
  defaultCalculator: DefaultCalculatorSelection | null;
  defaultCalculatorError: string | null;
  makingDefault: boolean;
  onMakeDefault: () => Promise<unknown>;
  onEditRates: () => void;
  onSetAdjustment: (adjustment: Adjustment | null) => void;
  onClear: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = window.setTimeout(() => setConfirmClear(false), 3500);
    return () => window.clearTimeout(t);
  }, [confirmClear]);

  const hasAnything = quote.rooms.length > 0 || quote.exterior.length > 0 || quote.washing !== "none";
  const hasAdjustment = quote.adjustment !== null;
  const isDefault = defaultCalculator?.quoteId === quote.id;
  const defaultIsCurrent =
    isDefault &&
    new Date(defaultCalculator.sourceQuoteUpdatedAt).getTime() === new Date(quote.updatedAt).getTime();
  const currentDefault = defaultIsCurrent ? defaultCalculator : null;
  const hasManualOverrides = Boolean(
    currentDefault?.tasks.some((task) => task.manualBudgetedHours !== null),
  );
  const displayedLabourHours = currentDefault?.budgetedHours ?? totals.hours;

  return (
    <Card className="p-5 lg:sticky lg:top-6">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Client price</div>
      <div className="font-display mt-1 text-3xl font-semibold tabular-nums text-[var(--color-heading)]">
        {fmtMoney(totals.price)}
      </div>
      <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">before HST</div>

      <div className="mt-4 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Labour budget</div>
      <div className="font-display mt-1 text-3xl font-semibold tabular-nums text-[var(--color-heading)]">
        {displayedLabourHours.toFixed(1)} h
      </div>
      {hasManualOverrides && currentDefault ? (
        <div className="mt-0.5 text-[11px] leading-4 text-[var(--color-warn)]">
          Calculated {currentDefault.calculatedHours.toFixed(1)} h · manual task overrides applied. Client price is unchanged.
        </div>
      ) : null}
      {totals.interior.hours > 0 ? (
        <div className="mt-0.5 text-[11px] tabular-nums text-[var(--color-muted)]">
          {fmtMoney(totals.interior.total)} × {Math.round(quote.rates.interior.labourPercent * 100)}% ={" "}
          {fmtMoney(totals.interior.total * quote.rates.interior.labourPercent)} ÷ $
          {quote.rates.interior.hourlyRate.toFixed(2)}/hr = {totals.interior.hours.toFixed(1)} h
        </div>
      ) : null}
      {totals.exterior.hours > 0 ? (
        <div className="mt-0.5 text-[11px] tabular-nums text-[var(--color-muted)]">
          {totals.interior.hours > 0 ? `+ ${totals.exterior.hours.toFixed(1)} h exterior · ` : ""}from production
          rates (sf/hr · lf/hr · hrs each)
        </div>
      ) : null}

      <div className="mt-5 space-y-2 border-t border-[var(--color-border)] pt-4">
        {totals.interior.total > 0 ? <Line label="Interior" value={fmtMoney(totals.interior.total)} /> : null}
        {totals.exterior.client > 0 ? <Line label="Exterior" value={fmtMoney(totals.exterior.client)} /> : null}
        {hasAdjustment ? <Line label="Subtotal" value={fmtMoney(totals.subtotal)} /> : null}
        {hasAdjustment ? (
          <Line label={quote.adjustment?.label || "Adjustment"} value={fmtMoney(totals.adjustmentAmount)} />
        ) : null}
        <Line label={`HST ${Math.round(quote.rates.exterior.hst * 100)}%`} value={fmtMoney(totals.hst)} />
        <Line label="Total incl. HST" value={fmtMoney(totals.totalWithHst)} strong />

        {hasAdjustment ? (
          <AdjustmentEditor adjustment={quote.adjustment!} onChange={onSetAdjustment} />
        ) : (
          <button
            type="button"
            onClick={() => onSetAdjustment({ mode: "amount", value: null, label: "Adjustment" })}
            disabled={!hasAnything}
            className="text-xs font-medium text-[var(--color-muted)] transition-colors hover:text-[var(--color-brand-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            + Add adjustment (discount, rounding…)
          </button>
        )}
      </div>

      <div className="mt-5 space-y-2">
        <Button variant="subtle" className="w-full" onClick={onEditRates}>
          ✎ Edit rates
        </Button>
        <Button
          variant="subtle"
          className="w-full"
          disabled={!hasAnything}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                buildCopyText(projectName, quote, totals, displayedLabourHours),
              );
              setCopied(true);
            } catch {
              // Clipboard unavailable (permissions) — nothing to do.
            }
          }}
        >
          {copied ? "Copied ✓" : "Copy summary"}
        </Button>
        {!isDefault ? (
          <Button
            variant="subtle"
            className="w-full"
            disabled={makingDefault}
            onClick={() => {
              if (
                window.confirm(
                  `Make “${quote.name}” the painter default? The painter task list will switch to this calculator.`,
                )
              ) {
                void onMakeDefault();
              }
            }}
          >
            {makingDefault ? "Saving…" : "Make default"}
          </Button>
        ) : null}
        {defaultCalculatorError ? (
          <p role="alert" className="text-[10px] leading-4 text-[var(--color-bad)]">
            {defaultCalculatorError}
          </p>
        ) : null}
        {confirmClear ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-bad-soft)] px-3 py-2">
            <span className="text-xs font-medium text-[var(--color-bad)]">Clear this quote?</span>
            <div className="flex gap-1">
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  onClear();
                  setConfirmClear(false);
                }}
              >
                Clear
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>
                Keep
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="w-full" disabled={!hasAnything} onClick={() => setConfirmClear(true)}>
            Clear quote
          </Button>
        )}
      </div>

      <p className="mt-4 text-[11px] leading-4 text-[var(--color-muted)]">{SYNC_LABELS[syncStatus]}</p>
    </Card>
  );
}
