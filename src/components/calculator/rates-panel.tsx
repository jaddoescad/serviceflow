"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import {
  CalculatorRates,
  EXTERIOR_CATALOG,
  PAINT_TIER_LABELS,
  PaintTierId,
} from "@/lib/calculator/engine";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--color-border)] px-5 py-4">
      <h3 className="font-display mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function RateRow({
  label,
  value,
  onChange,
  unit,
  step = "any",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  step?: string;
}) {
  // step="any": several sheet rates have 3 decimals (1.265, 8.625) and must not
  // trip HTML step validation.
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-[var(--color-text)]">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          name={label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
          min="0"
          step={step}
          value={Number.isFinite(value) ? round4(value) : 0}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            onChange(Number.isFinite(parsed) ? parsed : 0);
          }}
          onFocus={(e) => e.target.select()}
          className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-right text-sm tabular-nums text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
        />
        <span className="w-14 text-xs text-[var(--color-muted)]">{unit ?? ""}</span>
      </span>
    </label>
  );
}

function PercentRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <RateRow label={label} value={value * 100} onChange={(v) => onChange(v / 100)} unit="%" />
  );
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

export function RatesPanel({
  rates,
  onChange,
  onUseCompanyDefaults,
  onSaveCompanyDefaults,
  onClose,
}: {
  rates: CalculatorRates;
  onChange: (rates: CalculatorRates) => void;
  onUseCompanyDefaults: () => void;
  onSaveCompanyDefaults: () => void;
  onClose: () => void;
}) {
  const [savedDefaults, setSavedDefaults] = useState(false);

  useEffect(() => {
    if (!savedDefaults) return;
    const t = window.setTimeout(() => setSavedDefaults(false), 1800);
    return () => window.clearTimeout(t);
  }, [savedDefaults]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const interior = (patch: Partial<CalculatorRates["interior"]>) =>
    onChange({ ...rates, interior: { ...rates.interior, ...patch } });
  const exterior = (patch: Partial<CalculatorRates["exterior"]>) =>
    onChange({ ...rates, exterior: { ...rates.exterior, ...patch } });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px]" onClick={onClose} role="presentation">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Edit rates"
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
      >
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-[var(--color-heading)]">Rates</h2>
              <p className="text-xs text-[var(--color-muted)]">
                These apply to this quote only. New quotes start from the company defaults.
              </p>
            </div>
            <Button variant="subtle" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={onUseCompanyDefaults}>
              Use company defaults
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onSaveCompanyDefaults();
                setSavedDefaults(true);
              }}
            >
              {savedDefaults ? "Saved as defaults ✓" : "Set as company defaults"}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section title="Interior — wall paint ($/sqft, 2 coats)">
            {(Object.keys(PAINT_TIER_LABELS) as PaintTierId[]).map((tier) => (
              <RateRow
                key={tier}
                label={PAINT_TIER_LABELS[tier]}
                value={rates.interior.paintTiers[tier]}
                onChange={(v) => interior({ paintTiers: { ...rates.interior.paintTiers, [tier]: v } })}
                unit="$/sqft"
              />
            ))}
          </Section>

          <Section title="Interior — other prices">
            <RateRow label="Ceiling" value={rates.interior.ceiling} onChange={(v) => interior({ ceiling: v })} unit="$/sqft" />
            <RateRow label="Popcorn ceiling" value={rates.interior.popcorn} onChange={(v) => interior({ popcorn: v })} unit="$/sqft" />
            <RateRow label="Door" value={rates.interior.door} onChange={(v) => interior({ door: v })} unit="$ each" />
            <RateRow label="Closet" value={rates.interior.closet} onChange={(v) => interior({ closet: v })} unit="$ each" />
            <RateRow label="Trim (per coat)" value={rates.interior.trimPerCoat} onChange={(v) => interior({ trimPerCoat: v })} unit="$/lf" />
            <RateRow label="Crown molding" value={rates.interior.crown} onChange={(v) => interior({ crown: v })} unit="$/lf" />
            <PercentRow label="Third coat (of walls)" value={rates.interior.thirdCoatFactor} onChange={(v) => interior({ thirdCoatFactor: v })} />
          </Section>

          <Section title="Interior — labour budget">
            <PercentRow label="Labour share of price" value={rates.interior.labourPercent} onChange={(v) => interior({ labourPercent: v })} />
            <RateRow label="Hourly rate" value={rates.interior.hourlyRate} onChange={(v) => interior({ hourlyRate: v })} unit="$/hr" />
          </Section>

          <Section title="Exterior — globals">
            <RateRow label="Labour cost" value={rates.exterior.labourRate} onChange={(v) => exterior({ labourRate: v })} unit="$/hr" />
            <PercentRow label="Markup" value={rates.exterior.markup} onChange={(v) => exterior({ markup: v })} />
            <PercentRow label="HST" value={rates.exterior.hst} onChange={(v) => exterior({ hst: v })} />
            <PercentRow label="Sundries" value={rates.exterior.sundries} onChange={(v) => exterior({ sundries: v })} />
          </Section>

          <Section title="Exterior — materials">
            <RateRow
              label="Paint coverage"
              value={rates.exterior.coverage.paint}
              onChange={(v) => exterior({ coverage: { ...rates.exterior.coverage, paint: v } })}
              unit="sf/gal"
              step="10"
            />
            <RateRow
              label="Stain coverage"
              value={rates.exterior.coverage.stain}
              onChange={(v) => exterior({ coverage: { ...rates.exterior.coverage, stain: v } })}
              unit="sf/gal"
              step="10"
            />
            <RateRow
              label="Exterior paint"
              value={rates.exterior.materialPrices.paint}
              onChange={(v) => exterior({ materialPrices: { ...rates.exterior.materialPrices, paint: v } })}
              unit="$/gal"
            />
            <RateRow
              label="Deck stain"
              value={rates.exterior.materialPrices.stain}
              onChange={(v) => exterior({ materialPrices: { ...rates.exterior.materialPrices, stain: v } })}
              unit="$/gal"
            />
            <RateRow
              label="Solid stain (fences)"
              value={rates.exterior.materialPrices.solidStain}
              onChange={(v) => exterior({ materialPrices: { ...rates.exterior.materialPrices, solidStain: v } })}
              unit="$/gal"
            />
          </Section>

          <Section title="Exterior — prep & washing">
            <RateRow label="Masking / taping" value={rates.exterior.prep.masking} onChange={(v) => exterior({ prep: { ...rates.exterior.prep, masking: v } })} unit="$/hr" />
            <RateRow label="Sanding" value={rates.exterior.prep.sanding} onChange={(v) => exterior({ prep: { ...rates.exterior.prep, sanding: v } })} unit="$/hr" />
            <RateRow label="Other prep" value={rates.exterior.prep.other} onChange={(v) => exterior({ prep: { ...rates.exterior.prep, other: v } })} unit="$/hr" />
            <RateRow label="Setup / cleanup" value={rates.exterior.prep.setup} onChange={(v) => exterior({ prep: { ...rates.exterior.prep, setup: v } })} unit="$/hr" />
            <RateRow label="Washing — minimum" value={rates.exterior.washing.minimum} onChange={(v) => exterior({ washing: { ...rates.exterior.washing, minimum: v } })} unit="$" />
            <RateRow label="Washing — big job" value={rates.exterior.washing.big} onChange={(v) => exterior({ washing: { ...rates.exterior.washing, big: v } })} unit="$" />
          </Section>

          <Section title="Exterior — production rates">
            {EXTERIOR_CATALOG.filter((item) => item.kind !== "prepHour" && item.id !== "fenceSection").map((item) => (
              <RateRow
                key={item.id}
                label={item.label}
                value={rates.exterior.production[item.id] ?? item.defaultProduction}
                onChange={(v) => exterior({ production: { ...rates.exterior.production, [item.id]: v } })}
                unit={item.kind === "perUnit" ? "hrs each" : item.unit === "sf" ? "sf/hr" : "lf/hr"}
                step={item.kind === "perUnit" ? "0.25" : "5"}
              />
            ))}
            <p className="pt-1 text-[11px] leading-4 text-[var(--color-muted)]">
              Fence hours and sqft are set per line on the fence card.
            </p>
          </Section>
        </div>
      </aside>
    </div>
  );
}
