"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { Badge, Card, CardHeader, Field, Input, Select, Stat, StatGrid, cn } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import {
  CHANNEL_LABELS,
  MARKETING_CHANNELS,
  buildMarketingSalesSnapshot,
  getDefaultMarketingRange,
  getMarketingDatasetBounds,
  getPreviousPeriod,
  type MarketingChannelFilter,
  type MarketingChannelPerformance,
  type MarketingDateRange,
  type MarketingPlatformAccountSummary,
  type MarketingSalesSnapshot,
} from "@/lib/marketing-sales-metrics";
import type { MarketingSalesDataset } from "@/lib/marketing-sales";
import { MarketingSalesTrendChart } from "@/components/marketing-sales-trend-chart";

type PresetKey =
  | "mtd"
  | "last_month"
  | "qtd"
  | "ytd"
  | "last30"
  | "last90"
  | "custom";

type RevenueMode = "booked" | "cash";

const PRESET_LABELS: Record<PresetKey, string> = {
  mtd: "Month to date",
  last_month: "Last month",
  qtd: "Quarter to date",
  ytd: "Year to date",
  last30: "Last 30 days",
  last90: "Last 90 days",
  custom: "Custom range",
};

const cad = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});
const usd = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const integer = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

function money(value: number | null | undefined): string {
  return value == null ? "—" : cad.format(value);
}
function count(value: number | null | undefined): string {
  return value == null ? "—" : integer.format(value);
}
function roasText(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(2)}x`;
}
function daysText(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(0)}d`;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
function atNoon(value: string) {
  return new Date(`${value}T12:00:00Z`);
}
function addDays(value: string, days: number) {
  const date = atNoon(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}
function startOfMonth(value: string) {
  const date = atNoon(value);
  return isoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}
function startOfQuarter(value: string) {
  const date = atNoon(value);
  const quarter = Math.floor(date.getUTCMonth() / 3);
  return isoDate(new Date(Date.UTC(date.getUTCFullYear(), quarter * 3, 1)));
}
function startOfYear(value: string) {
  const date = atNoon(value);
  return isoDate(new Date(Date.UTC(date.getUTCFullYear(), 0, 1)));
}

function computePresetRange(preset: PresetKey, asOf: string): MarketingDateRange {
  switch (preset) {
    case "mtd":
      return { from: startOfMonth(asOf), to: asOf };
    case "last_month": {
      const lastMonthEnd = addDays(startOfMonth(asOf), -1);
      return { from: startOfMonth(lastMonthEnd), to: lastMonthEnd };
    }
    case "qtd":
      return { from: startOfQuarter(asOf), to: asOf };
    case "last30":
      return { from: addDays(asOf, -29), to: asOf };
    case "last90":
      return { from: addDays(asOf, -89), to: asOf };
    case "ytd":
      return { from: startOfYear(asOf), to: asOf };
    default:
      return { from: asOf, to: asOf };
  }
}

function percentDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
): { value: number; suffix?: string } | null {
  if (current == null || previous == null || previous === 0) return null;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(change)) return null;
  return { value: Math.round(change) };
}

type Evidence = {
  formula: string;
  numerator: string;
  denominator: string;
  scope: string;
  records?: { label: string; ids: string[] };
};

function EvidenceList({ label, ids }: { label: string; ids: string[] }) {
  const shown = ids.slice(0, 40);
  return (
    <div className="mt-1.5">
      <div className="font-medium text-[var(--color-heading)]">
        {label}: {integer.format(ids.length)}
      </div>
      {ids.length > 0 ? (
        <div className="mt-1 max-h-24 overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 font-mono text-[10px] leading-relaxed break-all">
          {shown.join(", ")}
          {ids.length > shown.length ? ` … +${integer.format(ids.length - shown.length)} more` : ""}
        </div>
      ) : null}
    </div>
  );
}

/** One KPI cell with an optional accessible disclosure explaining how it was computed. */
function MetricCell({
  label,
  value,
  hint,
  delta,
  deltaDirection = "higher_better",
  evidence,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: { value: number; suffix?: string } | null;
  deltaDirection?: "higher_better" | "lower_better" | "neutral";
  evidence?: Evidence;
}) {
  const deltaIsGood =
    delta && delta.value !== 0 && deltaDirection !== "neutral"
      ? deltaDirection === "higher_better"
        ? delta.value > 0
        : delta.value < 0
      : null;
  return (
    <div className="bg-[var(--color-surface)] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div className="mt-1 font-display text-lg font-semibold tabular-nums text-[var(--color-heading)]">
        {value}
      </div>
      {hint || delta ? (
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
          {delta ? (
            <span
              className={cn(
                "font-medium",
                deltaIsGood === true
                  ? "text-[var(--color-good)]"
                  : deltaIsGood === false
                    ? "text-[var(--color-bad)]"
                    : "text-[var(--color-muted)]",
              )}
            >
              {delta.value > 0 ? "▲" : delta.value < 0 ? "▼" : "•"}{" "}
              {Math.abs(delta.value)}
              {delta.suffix ?? "%"}
            </span>
          ) : null}
          {hint ? <span>{hint}</span> : null}
        </div>
      ) : null}
      {evidence ? (
        <details className="group mt-1.5">
          <summary className="cursor-pointer list-none rounded text-[11px] font-medium text-[var(--color-brand-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]">
            Evidence{" "}
            <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="mt-2 space-y-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5 text-[11px] text-[var(--color-muted)]">
            <div>
              <span className="font-medium text-[var(--color-heading)]">Formula: </span>
              {evidence.formula}
            </div>
            <div>
              <span className="font-medium text-[var(--color-heading)]">Numerator: </span>
              {evidence.numerator}
            </div>
            <div>
              <span className="font-medium text-[var(--color-heading)]">Denominator: </span>
              {evidence.denominator}
            </div>
            <div>
              <span className="font-medium text-[var(--color-heading)]">Scope: </span>
              {evidence.scope}
            </div>
            {evidence.records ? (
              <EvidenceList label={evidence.records.label} ids={evidence.records.ids} />
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function channelLabel(channel: MarketingChannelFilter) {
  return channel === "all" ? "all channels" : CHANNEL_LABELS[channel];
}

function ChannelRow({
  channel,
  revenueMode,
}: {
  channel: MarketingChannelPerformance;
  revenueMode: RevenueMode;
}) {
  const roas = revenueMode === "booked" ? channel.bookedRoas : channel.cashRoas;
  return (
    <tr className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
      <td className="px-3 py-2 font-medium text-[var(--color-heading)]">{channel.label}</td>
      <td className="px-3 py-2 text-right tabular-nums">{count(channel.leads)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{count(channel.customers)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{count(channel.jobs)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(channel.bookedRevenueBeforeHst)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(channel.cashRevenueBeforeHst)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(channel.averageJobSize)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{daysText(channel.medianSalesCycleDays)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(channel.spendCad)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(channel.cac)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{roasText(roas)}</td>
    </tr>
  );
}

function PlatformCurrencyGroup({
  currency,
  accounts,
}: {
  currency: "CAD" | "USD";
  accounts: MarketingPlatformAccountSummary[];
}) {
  const format = currency === "CAD" ? cad : usd;
  const totalSpend = accounts.reduce((total, account) => total + account.customerSpend, 0);
  const totalLeads = accounts.reduce((total, account) => total + account.customerLeads, 0);
  return (
    <div className="min-w-[320px] flex-1">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone={currency === "CAD" ? "brand" : "neutral"}>{currency} accounts</Badge>
        <span className="text-[11px] text-[var(--color-muted)]">
          never combined with other currencies
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        <table className="w-full text-xs">
          <thead className="bg-[var(--color-surface-2)] text-left text-[var(--color-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 text-right font-medium">Customer spend</th>
              <th className="px-3 py-2 text-right font-medium">Leads</th>
              <th className="px-3 py-2 text-right font-medium">CPL</th>
              <th className="px-3 py-2 text-right font-medium">Recruiting spend</th>
              <th className="px-3 py-2 text-right font-medium">Impressions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.accountId} className="border-t border-[var(--color-border)]">
                <td className="px-3 py-2 text-[var(--color-heading)]">{account.accountName}</td>
                <td className="px-3 py-2 text-right tabular-nums">{format.format(account.customerSpend)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{count(account.customerLeads)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {account.customerCpl == null ? "—" : format.format(account.customerCpl)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{format.format(account.recruitingSpend)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{count(account.impressions)}</td>
              </tr>
            ))}
            <tr className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] font-semibold text-[var(--color-heading)]">
              <td className="px-3 py-2">{currency} total</td>
              <td className="px-3 py-2 text-right tabular-nums">{format.format(totalSpend)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{count(totalLeads)}</td>
              <td className="px-3 py-2 text-right tabular-nums" colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MarketingSalesDashboard({ dataset }: { dataset: MarketingSalesDataset }) {
  const bounds = useMemo(() => getMarketingDatasetBounds(dataset), [dataset]);
  const [preset, setPreset] = useState<PresetKey>("ytd");
  const [customRange, setCustomRange] = useState<MarketingDateRange>(() =>
    getDefaultMarketingRange(dataset),
  );
  const [channel, setChannel] = useState<MarketingChannelFilter>("all");
  const [revenueMode, setRevenueMode] = useState<RevenueMode>("booked");
  const [compare, setCompare] = useState(false);

  const range = preset === "custom" ? customRange : computePresetRange(preset, bounds.maximum);

  const snapshot: MarketingSalesSnapshot = useMemo(
    () => buildMarketingSalesSnapshot(dataset, { ...range, channel }),
    [dataset, range.from, range.to, channel],
  );
  const priorRange = useMemo(() => getPreviousPeriod(range), [range.from, range.to]);
  const priorSnapshot: MarketingSalesSnapshot | null = useMemo(
    () => (compare ? buildMarketingSalesSnapshot(dataset, { ...priorRange, channel }) : null),
    [dataset, priorRange.from, priorRange.to, channel, compare],
  );

  const selectedRevenue =
    revenueMode === "booked" ? snapshot.bookedRevenueBeforeHst : snapshot.cashRevenueBeforeHst;
  const priorRevenue = priorSnapshot
    ? revenueMode === "booked"
      ? priorSnapshot.bookedRevenueBeforeHst
      : priorSnapshot.cashRevenueBeforeHst
    : null;
  const metaRoas = revenueMode === "booked" ? snapshot.metaBookedRoas : snapshot.metaCashRoas;
  const priorMetaRoas = priorSnapshot
    ? revenueMode === "booked"
      ? priorSnapshot.metaBookedRoas
      : priorSnapshot.metaCashRoas
    : null;

  const scopeText = `${fmtDate(range.from)}–${fmtDate(range.to)}, ${channelLabel(channel)}`;
  const revenueLabel = revenueMode === "booked" ? "Selected revenue (booked)" : "Selected revenue (cash-backed)";
  const revenueFormula =
    revenueMode === "booked"
      ? "Sum of invoice subtotal (before HST) for jobs connected to the selected lead cohort"
      : "Sum of bank-allocated cash applied to those invoices, prorated before HST";

  const platformGroups = useMemo(() => {
    const groups = new Map<"CAD" | "USD", MarketingPlatformAccountSummary[]>();
    for (const account of snapshot.platformAccounts) {
      const list = groups.get(account.currency) ?? [];
      list.push(account);
      groups.set(account.currency, list);
    }
    return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  }, [snapshot.platformAccounts]);

  const latestCapture = [
    dataset.quality.leadCapturedAt,
    dataset.quality.jobCapturedAt,
    dataset.quality.platformCapturedAt,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-[var(--color-heading)]">
            Marketing &amp; sales
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            {fmtDate(range.from)} – {fmtDate(range.to)} · lead-created cohort
            {channel !== "all" ? ` · ${CHANNEL_LABELS[channel]}` : ""}
          </p>
        </div>
        <div className="text-xs text-[var(--color-muted)]">Data through {fmtDate(bounds.maximum)}</div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <Field label="Range">
            <Select
              value={preset}
              onChange={(event) => setPreset(event.target.value as PresetKey)}
              className="w-40"
            >
              {(Object.keys(PRESET_LABELS) as PresetKey[]).map((key) => (
                <option key={key} value={key}>
                  {PRESET_LABELS[key]}
                </option>
              ))}
            </Select>
          </Field>
          {preset === "custom" ? (
            <>
              <Field label="From">
                <Input
                  type="date"
                  value={customRange.from}
                  min={bounds.minimum}
                  max={customRange.to}
                  onChange={(event) =>
                    setCustomRange((value) => ({ ...value, from: event.target.value }))
                  }
                />
              </Field>
              <Field label="To">
                <Input
                  type="date"
                  value={customRange.to}
                  min={customRange.from}
                  max={bounds.maximum}
                  onChange={(event) =>
                    setCustomRange((value) => ({ ...value, to: event.target.value }))
                  }
                />
              </Field>
            </>
          ) : null}
          <Field label="Channel">
            <Select
              value={channel}
              onChange={(event) => setChannel(event.target.value as MarketingChannelFilter)}
              className="w-44"
            >
              <option value="all">All channels</option>
              {MARKETING_CHANNELS.map((option) => (
                <option key={option} value={option}>
                  {CHANNEL_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Revenue">
            <Select
              value={revenueMode}
              onChange={(event) => setRevenueMode(event.target.value as RevenueMode)}
              className="w-40"
            >
              <option value="booked">Booked (invoiced)</option>
              <option value="cash">Cash-backed</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-xs text-[var(--color-muted)]">
            <input
              type="checkbox"
              checked={compare}
              onChange={(event) => setCompare(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--color-border)] accent-[var(--color-brand)]"
            />
            Compare to prior period
          </label>
        </div>

        <CardHeader
          title="Cohort &amp; revenue"
          subtitle="Leads use created date; connected jobs and revenue follow those leads"
        />
        <StatGrid columns={4}>
          <MetricCell
            label={revenueLabel}
            value={money(selectedRevenue)}
            delta={compare ? percentDelta(selectedRevenue, priorRevenue) : null}
            hint={compare && priorSnapshot ? `vs ${money(priorRevenue)} prior` : undefined}
            evidence={{
              formula: revenueFormula,
              numerator: `${integer.format(snapshot.jobs)} connected job${snapshot.jobs === 1 ? "" : "s"}`,
              denominator: "n/a",
              scope: scopeText,
              records: { label: "Connected proposal IDs", ids: snapshot.evidence.selectedProposalIds },
            }}
          />
          <MetricCell
            label="Leads (created cohort)"
            value={count(snapshot.leads)}
            delta={compare ? percentDelta(snapshot.leads, priorSnapshot?.leads) : null}
            evidence={{
              formula: "Count of leads with created-on date inside range and matching channel filter",
              numerator: "Matching leads",
              denominator: "n/a",
              scope: scopeText,
              records: { label: "Lead deal IDs", ids: snapshot.evidence.selectedLeadIds },
            }}
          />
          <MetricCell
            label="Unique customers"
            value={count(snapshot.customers)}
            delta={compare ? percentDelta(snapshot.customers, priorSnapshot?.customers) : null}
            evidence={{
              formula: "Distinct lead IDs among jobs connected to the selected lead cohort",
              numerator: "Distinct lead IDs with a connected job",
              denominator: "n/a",
              scope: scopeText,
            }}
          />
          <MetricCell
            label="Connected jobs"
            value={count(snapshot.jobs)}
            delta={compare ? percentDelta(snapshot.jobs, priorSnapshot?.jobs) : null}
            hint={
              snapshot.evidence.jobsWithoutInvoice > 0
                ? `${integer.format(snapshot.evidence.jobsWithoutInvoice)} without invoice`
                : undefined
            }
            evidence={{
              formula: "DripJobs jobs linked to the selected lead cohort via a confirmed originated relationship",
              numerator: "Confirmed lead-to-job links",
              denominator: "n/a",
              scope: scopeText,
              records: { label: "Job proposal IDs", ids: snapshot.evidence.selectedProposalIds },
            }}
          />
        </StatGrid>

        <CardHeader
          title="Invoice-to-cash bridge"
          subtitle="The same connected job invoices, with tax and bank settlement kept separate"
        />
        <StatGrid columns={4}>
          <MetricCell
            label="Booked before HST"
            value={money(snapshot.bookedRevenueBeforeHst)}
            hint="customer invoice subtotal"
          />
          <MetricCell
            label="HST billed"
            value={money(snapshot.bookedHst)}
            hint="customer invoice tax"
          />
          <MetricCell
            label="Invoice total"
            value={money(snapshot.bookedRevenueAfterHst)}
            hint="before HST + HST"
          />
          <MetricCell
            label="Bank cash received"
            value={money(snapshot.bankCashReceived)}
            hint={`${money(snapshot.amountReceivable)} remains on invoices`}
          />
        </StatGrid>

        <CardHeader
          title="Acquisition efficiency"
          subtitle="Ad spend uses bank posting date, scoped to Meta regardless of the channel filter"
        />
        <StatGrid columns={4}>
          <MetricCell
            label="Verified Meta spend"
            value={money(snapshot.metaSpendCad)}
            delta={compare ? percentDelta(snapshot.metaSpendCad, priorSnapshot?.metaSpendCad) : null}
            deltaDirection="neutral"
            evidence={{
              formula: "Sum of bank-posted advertising transactions attributed to Meta",
              numerator: "Bank transaction amounts",
              denominator: "n/a",
              scope: `${fmtDate(range.from)}–${fmtDate(range.to)} by bank posting date`,
              records: {
                label: "Spend transaction IDs",
                ids: snapshot.evidence.selectedSpendTransactionIds,
              },
            }}
          />
          <MetricCell
            label="Meta CPL"
            value={money(snapshot.metaCpl)}
            delta={compare ? percentDelta(snapshot.metaCpl, priorSnapshot?.metaCpl) : null}
            deltaDirection="lower_better"
            evidence={{
              formula: "Verified Meta spend ÷ Meta-attributed leads created in range",
              numerator: `Meta spend ${money(snapshot.metaSpendCad)}`,
              denominator: `${integer.format(snapshot.metaLeads)} Meta leads`,
              scope: `${fmtDate(range.from)}–${fmtDate(range.to)} · Meta leads only`,
            }}
          />
          <MetricCell
            label="Meta CAC"
            value={money(snapshot.metaCac)}
            delta={compare ? percentDelta(snapshot.metaCac, priorSnapshot?.metaCac) : null}
            deltaDirection="lower_better"
            evidence={{
              formula: "Verified Meta spend ÷ unique customers acquired from Meta leads",
              numerator: `Meta spend ${money(snapshot.metaSpendCad)}`,
              denominator: `${integer.format(snapshot.metaCustomers)} Meta customers`,
              scope: `${fmtDate(range.from)}–${fmtDate(range.to)} · Meta cohort only`,
            }}
          />
          <MetricCell
            label="Blended CAC"
            value={money(snapshot.blendedCac)}
            delta={compare ? percentDelta(snapshot.blendedCac, priorSnapshot?.blendedCac) : null}
            deltaDirection="lower_better"
            evidence={{
              formula: "Verified Meta spend ÷ unique customers acquired across all channels",
              numerator: `Meta spend ${money(snapshot.metaSpendCad)}`,
              denominator: `${integer.format(snapshot.blendedCustomers)} all-channel unique customers`,
              scope: `${fmtDate(range.from)}–${fmtDate(range.to)} · all-channel cohort, independent of channel filter`,
            }}
          />
        </StatGrid>
        <StatGrid columns={3}>
          <MetricCell
            label="Meta ROAS"
            value={roasText(metaRoas)}
            delta={compare ? percentDelta(metaRoas, priorMetaRoas) : null}
            evidence={{
              formula: `${revenueMode === "booked" ? "Booked" : "Cash-backed"} revenue from Meta-attributed jobs ÷ verified Meta spend`,
              numerator: money(
                revenueMode === "booked"
                  ? snapshot.metaBookedRevenueBeforeHst
                  : snapshot.metaCashRevenueBeforeHst,
              ),
              denominator: money(snapshot.metaSpendCad),
              scope: `${fmtDate(range.from)}–${fmtDate(range.to)} · Meta cohort only`,
            }}
          />
          <MetricCell
            label="Average job size"
            value={money(snapshot.averageJobSize)}
            evidence={{
              formula: "Selected booked revenue before HST ÷ connected jobs",
              numerator: money(snapshot.bookedRevenueBeforeHst),
              denominator: `${integer.format(snapshot.jobs)} connected jobs`,
              scope: scopeText,
            }}
          />
          <MetricCell
            label="Median sales cycle"
            value={daysText(snapshot.salesCycle.medianDays)}
            hint={`${integer.format(snapshot.salesCycle.sampleSize)} job${snapshot.salesCycle.sampleSize === 1 ? "" : "s"} sampled · lead created → proposal signed`}
            evidence={{
              formula: "Median calendar days from lead created date to signed proposal date",
              numerator: `${integer.format(snapshot.salesCycle.sampleSize)} dated job cycles`,
              denominator: "Jobs missing either date are excluded; cycles over 365 days are excluded",
              scope: scopeText,
            }}
          />
        </StatGrid>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Monthly leads &amp; revenue"
          subtitle="By lead-created month, within the selected range and channel"
        />
        <MarketingSalesTrendChart
          trend={snapshot.trend}
          revenueMode={revenueMode}
          hasSpend={channel === "all" || channel === "paid_social"}
        />
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Channel performance"
          subtitle="Em dash marks channels without verified direct ad spend"
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-xs">
            <thead className="bg-[var(--color-surface-2)] text-left text-[var(--color-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 text-right font-medium">Leads</th>
                <th className="px-3 py-2 text-right font-medium">Customers</th>
                <th className="px-3 py-2 text-right font-medium">Jobs</th>
                <th className="px-3 py-2 text-right font-medium">Booked revenue</th>
                <th className="px-3 py-2 text-right font-medium">Cash revenue</th>
                <th className="px-3 py-2 text-right font-medium">Avg job</th>
                <th className="px-3 py-2 text-right font-medium">Median cycle</th>
                <th className="px-3 py-2 text-right font-medium">Verified spend</th>
                <th className="px-3 py-2 text-right font-medium">CAC</th>
                <th className="px-3 py-2 text-right font-medium">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.channels.map((row) => (
                <ChannelRow key={row.channel} channel={row} revenueMode={revenueMode} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Meta platform account reconciliation"
          subtitle="Native-currency monthly exports overlapping the range; CAD and USD are never summed, and partial months are not prorated"
        />
        <div className="flex flex-wrap gap-4 p-4">
          {platformGroups.length === 0 ? (
            <p className="px-1 text-sm text-[var(--color-muted)]">
              No Meta platform account activity in this range.
            </p>
          ) : (
            platformGroups.map(([currency, accounts]) => (
              <PlatformCurrencyGroup key={currency} currency={currency} accounts={accounts} />
            ))
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 hover:bg-[var(--color-surface-2)]">
            <div>
              <h3 className="font-display text-sm font-semibold text-[var(--color-heading)]">
                Data quality &amp; evidence
              </h3>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                DripJobs linkage, missing sources, and refresh time
              </p>
            </div>
            <span
              aria-hidden="true"
              className="text-[var(--color-muted)] transition-transform group-open:rotate-180"
            >
              ▾
            </span>
          </summary>
          <div className="border-t border-[var(--color-border)]">
            <StatGrid columns={3}>
              <Stat
                label="DripJobs jobs linked"
                value={`${integer.format(dataset.quality.confirmedJobLinks)} / ${integer.format(dataset.quality.totalJobs)}`}
                hint="Confirmed lead-to-job links vs. total DripJobs jobs"
              />
              <Stat
                label="Missing lead source"
                value={count(dataset.quality.missingLeadSourceJobs)}
                hint="DripJobs jobs with no resolvable lead"
              />
              <Stat
                label="Jobs without invoice"
                value={count(snapshot.evidence.jobsWithoutInvoice)}
                hint={`${count(dataset.quality.linkedJobsWithoutInvoice)} across full dataset`}
              />
              <Stat
                label="Jobs without cash evidence"
                value={count(snapshot.evidence.jobsWithoutCashEvidence)}
                hint={`${count(dataset.quality.linkedJobsWithoutCashEvidence)} across full dataset`}
              />
              <Stat
                label="Invoices in scope"
                value={count(snapshot.evidence.selectedInvoiceIds.length)}
                hint="Distinct customer invoices tied to selected jobs"
              />
              <Stat
                label="Cash allocations in scope"
                value={count(snapshot.evidence.selectedAllocationCount)}
                hint={`${count(dataset.quality.activeCustomerInvoiceAllocations)} active across full dataset`}
              />
            </StatGrid>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs text-[var(--color-muted)]">
              <span>Last bank spend posted {fmtDate(dataset.quality.spendLastPostedOn)}</span>
              <span>Data last refreshed {latestCapture ? fmtDate(latestCapture) : "—"}</span>
            </div>
          </div>
        </details>
      </Card>
    </div>
  );
}
