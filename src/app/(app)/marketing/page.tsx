import { PageHeader } from "@/components/kpi";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Select,
  Stat,
  StatusText,
  cn,
} from "@/components/ui";
import { MarketingMonthlyChart } from "@/components/marketing-monthly-chart";
import { requireStaff } from "@/lib/auth";
import {
  getMarketingMetrics,
  getMarketingYears,
  type MarketingMetrics,
} from "@/lib/marketing";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const percent = new Intl.NumberFormat("en-CA", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const integer = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function money(
  value: number,
  currency: "CAD" | "USD" = "CAD",
  fractionDigits = 0,
) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function pct(value: number | null) {
  return value == null ? "—" : percent.format(value);
}

function ratioTimes(value: number | null) {
  return value == null ? "—" : `${value.toFixed(2)}×`;
}

function roasTone(value: number | null): "neutral" | "good" | "warn" | "bad" {
  if (value == null) return "neutral";
  if (value >= 3) return "good";
  if (value >= 1) return "warn";
  return "bad";
}

function formatCapturedAt(value: string) {
  return new Date(value).toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Thin proportion bar used for pipeline stages, age buckets, and sources. */
function MiniBar({
  value,
  max,
  color = "var(--color-brand)",
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div
      aria-hidden="true"
      className="h-1 overflow-hidden rounded-full bg-[var(--color-chip-muted)]"
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${width}%`, backgroundColor: color }}
      />
    </div>
  );
}

function FunnelStep({
  label,
  count,
  detail,
  emphasis,
}: {
  label: string;
  count: number;
  detail?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-display text-xl font-semibold tabular-nums",
          emphasis ? "text-[var(--color-good)]" : "text-[var(--color-heading)]",
        )}
      >
        {integer.format(count)}
      </div>
      {detail ? (
        <div className="mt-0.5 truncate text-[11px] text-[var(--color-muted)]">{detail}</div>
      ) : null}
    </div>
  );
}

function ReconciliationSection({ marketing }: { marketing: MarketingMetrics }) {
  const { paidSocial } = marketing;
  const max = Math.max(paidSocial.platformCustomerLeads, paidSocial.crmRecords, 1);
  return (
    <Card>
      <CardHeader
        title="Platform leads vs CRM records"
        subtitle="Meta lead-form events reconciled against deduplicated DripJobs paid-social opportunities"
        right={
          <Badge tone={paidSocial.captureRate != null && paidSocial.captureRate < 0.5 ? "warn" : "neutral"}>
            {pct(paidSocial.captureRate)} capture
          </Badge>
        }
      />
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="text-[var(--color-muted)]">Meta customer lead events</span>
              <span className="font-semibold tabular-nums text-[var(--color-heading)]">
                {integer.format(paidSocial.platformCustomerLeads)}
              </span>
            </div>
            <MiniBar value={paidSocial.platformCustomerLeads} max={max} />
          </div>
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="text-[var(--color-muted)]">CRM paid-social opportunities</span>
              <span className="font-semibold tabular-nums text-[var(--color-heading)]">
                {integer.format(paidSocial.crmRecords)}
              </span>
            </div>
            <MiniBar
              value={paidSocial.crmRecords}
              max={max}
              color="var(--color-brand-strong)"
            />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-[var(--color-border)] pt-3">
            <StatusText tone="warn">
              Gap: {integer.format(paidSocial.captureGap)} lead events
            </StatusText>
            <StatusText tone="good">
              {integer.format(paidSocial.crmWonJobs)} won
            </StatusText>
            <StatusText tone="brand">
              {integer.format(paidSocial.crmActive)} active
            </StatusText>
            <StatusText tone="neutral">
              {integer.format(paidSocial.crmLost)} lost
            </StatusText>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[var(--color-muted)]">
              Bank cost per platform lead event
            </span>
            <span className="font-semibold tabular-nums text-[var(--color-heading)]">
              {paidSocial.blendedBankCpl == null
                ? "—"
                : money(paidSocial.blendedBankCpl, "CAD", 2)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[var(--color-muted)]">
              Bank cost per CRM paid-social opportunity
            </span>
            <span className="font-semibold tabular-nums text-[var(--color-heading)]">
              {paidSocial.crmRecordedCost == null
                ? "—"
                : money(paidSocial.crmRecordedCost, "CAD", 2)}
            </span>
          </div>
          <p className="border-t border-[var(--color-border)] pt-3 text-xs leading-5 text-[var(--color-muted)]">
            These are different event types: a Meta lead is a form submission
            counted by the platform; a CRM record is a deduplicated DripJobs
            opportunity. Some gap is normal (duplicates, spam, wrong-fit), but{" "}
            {paidSocial.captureGap > 0 ? (
              <>
                {integer.format(paidSocial.captureGap)} lead events with no
                matching opportunity at {pct(paidSocial.captureRate)} capture is
                the first place to look for lost revenue — audit Meta lead-form
                responses against DripJobs intake before buying more traffic.
              </>
            ) : (
              <>every platform lead event this year has a matching CRM record.</>
            )}
          </p>
        </div>
      </div>
    </Card>
  );
}

function PipelineSection({ marketing }: { marketing: MarketingMetrics }) {
  const { stages, ageBuckets } = marketing.pipeline;
  const maxStageDeals = Math.max(0, ...stages.map((row) => row.deals));
  const maxAgeDeals = Math.max(0, ...ageBuckets.map((row) => row.deals));
  const staleDeals = ageBuckets
    .filter((row) => row.label === "31–60 days" || row.label === "60+ days")
    .reduce((total, row) => total + row.deals, 0);
  return (
    <Card>
      <CardHeader
        title="Active pipeline"
        subtitle={`${integer.format(marketing.funnel.active)} open deals · ${money(marketing.funnel.activePipelineValue)} value`}
        right={
          staleDeals > 0 ? (
            <Badge tone="warn">{integer.format(staleDeals)} deals over 30 days</Badge>
          ) : null
        }
      />
      {stages.length === 0 ? (
        <EmptyState>No active deals in the pipeline for this year.</EmptyState>
      ) : (
        <div className="grid gap-x-8 gap-y-5 p-5 md:grid-cols-2">
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
              By stage
            </div>
            <div className="space-y-3">
              {stages.map((row) => (
                <div key={row.label}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="truncate text-[var(--color-text)]">{row.label}</span>
                    <span className="shrink-0 tabular-nums text-[var(--color-muted)]">
                      {integer.format(row.deals)} · {money(row.value)}
                    </span>
                  </div>
                  <MiniBar value={row.deals} max={maxStageDeals} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
              Deal age at export
            </div>
            <div className="space-y-3">
              {ageBuckets.map((row) => {
                const stale = row.label === "60+ days";
                const aging = row.label === "31–60 days";
                return (
                  <div key={row.label}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                      <span
                        className={cn(
                          stale && row.deals > 0
                            ? "font-medium text-[var(--color-bad)]"
                            : aging && row.deals > 0
                              ? "font-medium text-[var(--color-warn)]"
                              : "text-[var(--color-text)]",
                        )}
                      >
                        {row.label}
                      </span>
                      <span className="shrink-0 tabular-nums text-[var(--color-muted)]">
                        {integer.format(row.deals)} · {money(row.value)}
                      </span>
                    </div>
                    <MiniBar
                      value={row.deals}
                      max={maxAgeDeals}
                      color={
                        stale
                          ? "var(--color-bad)"
                          : aging
                            ? "var(--color-warn)"
                            : "var(--color-brand)"
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [, years, params] = await Promise.all([
    requireStaff(),
    getMarketingYears(),
    searchParams,
  ]);
  const requestedYear = Number(firstParam(params.year));
  const defaultYear = years[0] ?? new Date().getFullYear();
  const year = years.includes(requestedYear) ? requestedYear : defaultYear;
  const marketing = await getMarketingMetrics(year);
  const { accounting, funnel, paidSocial, paidSocialRevenue, dataQuality, salesCycle } =
    marketing;
  const customerCampaigns = marketing.campaigns.filter(
    (row) => row.purpose === "customer_acquisition",
  );
  const otherCampaigns = marketing.campaigns.filter(
    (row) => row.purpose !== "customer_acquisition",
  );
  const yearExactDates = dataQuality.exactLeadDates;
  const yearEstimatedDates =
    dataQuality.selectedYearRecords - dataQuality.exactLeadDates;

  return (
    <>
      <PageHeader
        title="Marketing"
        subtitle={`${year} performance · bank ledger is the CAD accounting source of truth`}
        actions={
          <form method="get" className="flex items-center gap-2">
            <Select name="year" defaultValue={String(year)} aria-label="Marketing year">
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
            <button
              type="submit"
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]"
            >
              Apply
            </button>
          </form>
        }
      />

      {/* Primary KPI band */}
      <Card className="overflow-hidden">
        <div className="grid gap-px bg-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Stat
            label="Bank marketing spend"
            value={money(accounting.spend, "CAD", 2)}
            hint={`${integer.format(accounting.transactionCount)} posted CAD transactions`}
          />
          <Stat
            label="Meta customer leads"
            value={integer.format(paidSocial.platformCustomerLeads)}
            hint="Platform lead events, both accounts"
          />
          <Stat
            label="Blended bank CPL"
            value={
              paidSocial.blendedBankCpl == null
                ? "—"
                : money(paidSocial.blendedBankCpl, "CAD", 2)
            }
            hint="Bank spend ÷ Meta customer leads"
          />
          <Stat
            label="Closed win rate"
            value={pct(funnel.closedWinRate)}
            hint={`${integer.format(funnel.won)} won ÷ ${integer.format(funnel.closed)} closed`}
          />
          <Stat
            label="Won jobs"
            value={integer.format(funnel.won)}
            hint={`${money(funnel.wonJobValue)} job value`}
            tone="good"
          />
          <Stat
            label="Active pipeline"
            value={money(funnel.activePipelineValue)}
            hint={`${integer.format(funnel.active)} open deals`}
          />
        </div>
      </Card>

      {/* Monthly performance */}
      <Card className="mt-4">
        <CardHeader
          title={`${year} monthly performance`}
          subtitle="Meta customer leads and CRM records by estimated lead month · bank spend by posted month"
          right={
            <Badge tone={yearEstimatedDates > 0 ? "warn" : "good"}>
              {integer.format(yearExactDates)} exact ·{" "}
              {integer.format(yearEstimatedDates)} estimated lead dates
            </Badge>
          }
        />
        <MarketingMonthlyChart monthly={marketing.monthly} />
        <p className="border-t border-[var(--color-border)] px-5 py-3 text-xs leading-5 text-[var(--color-muted)]">
          CRM monthly placement uses estimated lead-created dates:{" "}
          {integer.format(dataQuality.exactLeadDates)} exact,{" "}
          {integer.format(dataQuality.dayPrecisionEstimates)} day-precision,{" "}
          {integer.format(dataQuality.monthPrecisionEstimates)} month-precision, and{" "}
          {integer.format(dataQuality.modeledLeadDates)} modeled from the sales-cycle
          median. Hover any month for its exact/estimated split. Bank spend is by
          bank posting date and can lag the platform activity it paid for.
        </p>
      </Card>

      {/* Reconciliation + Funnel */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <ReconciliationSection marketing={marketing} />
        <Card>
          <CardHeader
            title="Funnel (all sources)"
            subtitle="Deduplicated CRM opportunities with estimated lead dates in this year"
            right={<Badge tone="neutral">{pct(funnel.closedWinRate)} closed win rate</Badge>}
          />
          <div className="flex items-stretch divide-x divide-[var(--color-border)]">
            <FunnelStep
              label="Opportunities"
              count={funnel.opportunities}
              detail="All CRM records"
            />
            <FunnelStep
              label="Closed"
              count={funnel.closed}
              detail={`${integer.format(funnel.lost)} lost`}
            />
            <FunnelStep
              label="Won"
              count={funnel.won}
              detail={money(funnel.wonJobValue)}
              emphasis
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-3 text-sm">
            <StatusText tone="brand">
              {integer.format(funnel.active)} still active
            </StatusText>
            <span className="tabular-nums text-[var(--color-muted)]">
              {money(funnel.activePipelineValue)} open pipeline value
            </span>
          </div>
        </Card>
      </div>

      {/* Pipeline health */}
      <div className="mt-4">
        <PipelineSection marketing={marketing} />
      </div>

      {/* Meta accounts — native currency */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {marketing.platformAccounts.length === 0 ? (
          <Card className="md:col-span-2">
            <EmptyState>No Meta account delivery captured for this year.</EmptyState>
          </Card>
        ) : (
          marketing.platformAccounts.map((account) => (
            <Card key={account.accountId}>
              <CardHeader
                title={account.name}
                subtitle={`${account.accountId} · ${integer.format(account.activeMonths)} active months · ${integer.format(account.impressions)} impressions`}
                right={<Badge tone="brand">{account.currency} account</Badge>}
              />
              <div className="grid grid-cols-2 divide-x divide-[var(--color-border)]">
                <div className="px-4 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                    Customer acquisition
                  </div>
                  <div className="mt-1 font-display text-xl font-semibold tabular-nums text-[var(--color-heading)]">
                    {money(account.customerSpend, account.currency)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                    {integer.format(account.customerLeads)} leads ·{" "}
                    {account.customerCpl == null
                      ? "no CPL"
                      : `${money(account.customerCpl, account.currency, 2)} CPL`}
                  </div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                    Recruiting
                  </div>
                  <div className="mt-1 font-display text-xl font-semibold tabular-nums text-[var(--color-heading)]">
                    {money(account.recruitingSpend, account.currency)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                    {integer.format(account.recruitingLeads)} applicant leads
                  </div>
                </div>
              </div>
              <p className="border-t border-[var(--color-border)] px-4 py-2.5 text-[11px] leading-4 text-[var(--color-muted)]">
                Platform-reported {account.currency} delivery. Not added to the
                other account or to the CAD bank total without conversion evidence.
              </p>
            </Card>
          ))
        )}
      </div>

      {/* Source performance */}
      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title="Lead sources"
          subtitle={`Known source on ${pct(dataQuality.knownSourceCoverage)} of records (${integer.format(dataQuality.knownSourceRecords)} of ${integer.format(dataQuality.selectedYearRecords)}) — rows below include the unknown remainder`}
        />
        {marketing.sourcePerformance.length === 0 ? (
          <EmptyState>No CRM records for this year.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[13px]">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-4 py-2.5 text-right font-medium">Records</th>
                  <th className="px-4 py-2.5 text-right font-medium">Active</th>
                  <th className="px-4 py-2.5 text-right font-medium">Won</th>
                  <th className="px-4 py-2.5 text-right font-medium">Lost</th>
                  <th className="px-4 py-2.5 text-right font-medium">Closed win rate</th>
                  <th className="px-4 py-2.5 text-right font-medium">Won job value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {marketing.sourcePerformance.map((row) => (
                  <tr key={row.channel}>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "font-medium",
                          row.channel === "unknown"
                            ? "text-[var(--color-muted)]"
                            : "text-[var(--color-heading)]",
                        )}
                      >
                        {row.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {integer.format(row.records)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {integer.format(row.active)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-good)]">
                      {integer.format(row.won)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {integer.format(row.lost)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {pct(row.closedWinRate)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {money(row.wonJobValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Supporting evidence: revenue + sales cycle */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Paid-social revenue evidence"
            subtitle="Invoices attributed to Meta ads, measured against the full bank marketing total"
          />
          <div className="grid grid-cols-2 gap-px bg-[var(--color-border)] sm:grid-cols-4">
            <Stat
              label="Invoiced jobs"
              value={integer.format(paidSocialRevenue.jobs)}
              hint={
                paidSocialRevenue.customerAcquisitionCost == null
                  ? undefined
                  : `${money(paidSocialRevenue.customerAcquisitionCost, "CAD", 2)} blended cost / job`
              }
            />
            <Stat
              label="Booked revenue"
              value={money(paidSocialRevenue.bookedRevenueBeforeHst)}
              hint="Before HST"
            />
            <Stat
              label="Booked ROAS"
              value={ratioTimes(paidSocialRevenue.bookedRoas)}
              tone={roasTone(paidSocialRevenue.bookedRoas)}
            />
            <Stat
              label="Cash ROAS"
              value={ratioTimes(paidSocialRevenue.cashRoas)}
              hint={`${money(paidSocialRevenue.bankBackedRevenueBeforeHst)} bank-backed`}
              tone={roasTone(paidSocialRevenue.cashRoas)}
            />
          </div>
          <p className="border-t border-[var(--color-border)] px-5 py-3 text-xs leading-5 text-[var(--color-muted)]">
            Denominator is the full {money(accounting.spend)} bank marketing spend,
            recruiting included — deliberately conservative. Marketing is{" "}
            {pct(accounting.marketingShareOfPaintingRevenueCash)} of{" "}
            {money(accounting.paintingRevenueCash)} posted Painting revenue cash this year.
          </p>
        </Card>
        <Card>
          <CardHeader
            title="Sales cycle"
            subtitle="Lead created → proposal signed, exact-dated won jobs only"
            right={<Badge tone="neutral">n = {integer.format(salesCycle.sampleSize)}</Badge>}
          />
          {salesCycle.sampleSize === 0 ? (
            <EmptyState>
              No won jobs with exact lead and signed dates for this year yet.
            </EmptyState>
          ) : (
            <div className="grid grid-cols-2 gap-px bg-[var(--color-border)] sm:grid-cols-4">
              <Stat
                label="Median"
                value={salesCycle.medianDays == null ? "—" : `${salesCycle.medianDays} d`}
              />
              <Stat
                label="Mean"
                value={salesCycle.meanDays == null ? "—" : `${salesCycle.meanDays} d`}
              />
              <Stat
                label="25th pct"
                value={salesCycle.p25Days == null ? "—" : `${salesCycle.p25Days} d`}
              />
              <Stat
                label="75th pct"
                value={salesCycle.p75Days == null ? "—" : `${salesCycle.p75Days} d`}
              />
            </div>
          )}
        </Card>
      </div>

      {/* Campaigns */}
      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title="Meta campaigns"
          subtitle="Platform-reported spend and leads in each account's native currency"
        />
        {marketing.campaigns.length === 0 ? (
          <EmptyState>No campaign delivery captured for this year.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Campaign</th>
                  <th className="px-4 py-2.5 font-medium">Purpose</th>
                  <th className="px-4 py-2.5 text-right font-medium">Spend</th>
                  <th className="px-4 py-2.5 text-right font-medium">Leads</th>
                  <th className="px-4 py-2.5 text-right font-medium">CPL</th>
                  <th className="px-4 py-2.5 text-right font-medium">Impressions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {[...customerCampaigns, ...otherCampaigns].map((row) => (
                  <tr key={`${row.accountId}-${row.campaignId}-${row.purpose}`}>
                    <td className="max-w-[380px] px-4 py-2.5">
                      <div className="truncate font-medium text-[var(--color-heading)]">
                        {row.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                        {row.accountName} · {row.currency}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        tone={row.purpose === "customer_acquisition" ? "brand" : "neutral"}
                      >
                        {row.purpose === "customer_acquisition"
                          ? "Customer acquisition"
                          : row.purpose === "recruiting"
                            ? "Recruiting"
                            : "Other"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {money(row.spend, row.currency, 2)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {integer.format(row.leads)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {row.cpl == null ? "—" : money(row.cpl, row.currency, 2)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {integer.format(row.impressions)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Data quality disclosure */}
      <Card className="mt-4 overflow-hidden">
        <details>
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-sm font-semibold text-[var(--color-heading)]">
            <span>Data quality &amp; evidence</span>
            <span className="flex items-center gap-2 text-xs font-normal text-[var(--color-muted)]">
              {pct(dataQuality.knownSourceCoverage)} known-source coverage
              {marketing.capturedAt ? (
                <Badge tone="neutral">
                  Captured {formatCapturedAt(marketing.capturedAt)}
                </Badge>
              ) : null}
            </span>
          </summary>
          <div className="border-t border-[var(--color-border)]">
            <div className="grid grid-cols-2 gap-px bg-[var(--color-border)] sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Raw CRM rows" value={integer.format(dataQuality.rawRows)} />
              <Stat
                label="Canonical records"
                value={integer.format(dataQuality.canonicalRecords)}
                hint={`${integer.format(dataQuality.duplicateRows)} duplicates removed`}
              />
              <Stat
                label={`${year} records`}
                value={integer.format(dataQuality.selectedYearRecords)}
                hint={`${integer.format(dataQuality.knownSourceRecords)} with known source`}
              />
              <Stat
                label="Exact lead dates"
                value={integer.format(dataQuality.exactLeadDates)}
                tone="good"
              />
              <Stat
                label="Day / month estimates"
                value={`${integer.format(dataQuality.dayPrecisionEstimates)} / ${integer.format(dataQuality.monthPrecisionEstimates)}`}
              />
              <Stat
                label="Modeled / unknown"
                value={`${integer.format(dataQuality.modeledLeadDates)} / ${integer.format(dataQuality.unknownLeadDates)}`}
                tone={dataQuality.modeledLeadDates > 0 ? "warn" : "neutral"}
              />
            </div>
            <ul className="space-y-2 border-t border-[var(--color-border)] px-5 py-4 text-xs leading-5 text-[var(--color-muted)]">
              {dataQuality.caveats.map((caveat) => (
                <li key={caveat} className="flex gap-2">
                  <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-muted)]" />
                  {caveat}
                </li>
              ))}
            </ul>
          </div>
        </details>
      </Card>
    </>
  );
}
