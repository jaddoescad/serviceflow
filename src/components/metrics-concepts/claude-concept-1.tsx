"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BusinessPulseMonthlyPoint } from "@/lib/business-pulse-metrics";
import type { MetricsConceptPulse } from "./metrics-concept-data";

const dollars = (cents: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(cents / 100);

// Rates may arrive as fractions (0.529) or percents (52.9); normalize to percent.
const asPercent = (value: number) =>
  Math.abs(value) <= 1 ? value * 100 : value;

const formatPercent = (value: number) => `${asPercent(value).toFixed(1)}%`;

const compactDollars = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const monthName = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleString("en-CA", {
    month: "short",
    timeZone: "UTC",
  });

type GrowthReturnChartPoint = {
  month: string;
  label: string;
  isPartial: boolean;
  isFuture: boolean;
  bookedSalesDollars: number | null;
  metaSpendDollars: number | null;
  leads: number | null;
  appointments: number | null;
  setRatePct: number | null;
  setRateContacts: number | null;
  setRateBookedContacts: number | null;
  setRateBasis: BusinessPulseMonthlyPoint["setRateBasis"] | null;
  proposalRatePct: number | null;
  closingRatePct: number | null;
  closingBasis: BusinessPulseMonthlyPoint["closingBasis"] | null;
  bookedJobsInLeadBar: number | null;
  leadsNotBooked: number | null;
  bookedSalesCents: number | null;
  metaSpendCents: number | null;
  metaSpendSource: BusinessPulseMonthlyPoint["metaSpendSource"] | null;
  metaCostPerLeadCents: number | null;
  proposals: number | null;
  acceptedProposals: number | null;
  jobsWon: number | null;
  acceptedJobs: number | null;
  blendedCacCents: number | null;
  bookedRoas: number | null;
  metaLeads: number | null;
  organicOtherLeads: number | null;
  metaLeadSharePct: number | null;
  metaAcceptedJobs: number | null;
  organicOtherAcceptedJobs: number | null;
  metaAcceptedSharePct: number | null;
  metaBookedSalesDollars: number | null;
  organicOtherBookedSalesDollars: number | null;
  metaBookedRevenueCents: number | null;
  metaBookedSalesSharePct: number | null;
};

function spendSourceLabel(
  source: BusinessPulseMonthlyPoint["metaSpendSource"],
): string {
  if (source === "bank") return "bank/card";
  if (source === "bank_and_meta_api") return "bank + Meta API";
  return "Meta API";
}

function closingRateLabel(
  basis: BusinessPulseMonthlyPoint["closingBasis"] | null,
): string {
  return basis === "dripjobs_qualified_proposal_cohort"
    ? "Closing ratio · DripJobs cohort"
    : "Closing ratio · imported cohort";
}

function MonthlyTooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

function growthReturnTooltipPoint(
  active?: boolean,
  payload?: ReadonlyArray<{ payload: GrowthReturnChartPoint }>,
): GrowthReturnChartPoint | null {
  return active ? payload?.[0]?.payload ?? null : null;
}

function GrowthReturnTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: GrowthReturnChartPoint }>;
}) {
  const point = growthReturnTooltipPoint(active, payload);
  if (!point || point.isFuture) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-slate-900">
        {monthName(point.month)} {point.month.slice(0, 4)}
        {point.isPartial ? " (month to date)" : ""}
      </p>
      <div className="mt-1.5 space-y-0.5">
        <MonthlyTooltipRow
          label="Booked sales"
          value={point.bookedSalesCents == null ? "—" : dollars(point.bookedSalesCents)}
        />
        <MonthlyTooltipRow
          label={`Meta spend${point.metaSpendSource ? ` (${spendSourceLabel(point.metaSpendSource)})` : ""}`}
          value={point.metaSpendCents == null ? "—" : dollars(point.metaSpendCents)}
        />
        <MonthlyTooltipRow label="Leads" value={String(point.leads ?? 0)} />
        <MonthlyTooltipRow
          label="Meta CPL"
          value={point.metaCostPerLeadCents == null ? "—" : dollars(point.metaCostPerLeadCents)}
        />
        <MonthlyTooltipRow label="Qualified proposals" value={String(point.proposals ?? 0)} />
        <MonthlyTooltipRow
          label="Accepted proposals"
          value={String(point.acceptedProposals ?? 0)}
        />
        <MonthlyTooltipRow label="Jobs Won" value={String(point.jobsWon ?? 0)} />
        <MonthlyTooltipRow
          label="Operational jobs accepted"
          value={String(point.acceptedJobs ?? 0)}
        />
        <MonthlyTooltipRow
          label="Blended CAC"
          value={point.blendedCacCents == null ? "—" : dollars(point.blendedCacCents)}
        />
        <MonthlyTooltipRow
          label="Meta booked ROAS"
          value={point.bookedRoas == null ? "—" : `${point.bookedRoas.toFixed(2)}x`}
        />
      </div>
    </div>
  );
}

function FunnelHealthTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: GrowthReturnChartPoint }>;
}) {
  const point = growthReturnTooltipPoint(active, payload);
  if (!point || point.isFuture) return null;

  const rate = (value: number | null) =>
    value == null ? "—" : `${value.toFixed(1)}%`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-slate-900">
        {monthName(point.month)} {point.month.slice(0, 4)}
        {point.isPartial ? " (month to date)" : ""}
      </p>
      <div className="mt-1.5 space-y-0.5">
        <MonthlyTooltipRow
          label={
            point.setRateBasis === "dripjobs_contact_cohort"
              ? "Set rate · DripJobs cohort"
              : "Set rate · imported cohort"
          }
          value={`${rate(point.setRatePct)} · ${point.setRateBookedContacts ?? 0} / ${point.setRateContacts ?? 0}`}
        />
        <MonthlyTooltipRow
          label="Qualified proposal rate"
          value={`${rate(point.proposalRatePct)} · ${point.proposals ?? 0} / ${point.setRateContacts ?? 0}`}
        />
        <MonthlyTooltipRow
          label={closingRateLabel(point.closingBasis)}
          value={`${rate(point.closingRatePct)} · ${point.acceptedProposals ?? 0} / ${point.proposals ?? 0}`}
        />
        <MonthlyTooltipRow label="Jobs Won · separate" value={String(point.jobsWon ?? 0)} />
      </div>
    </div>
  );
}

function SpendRevenueTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: GrowthReturnChartPoint }>;
}) {
  const point = growthReturnTooltipPoint(active, payload);
  if (!point || point.isFuture) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-slate-900">
        {monthName(point.month)} {point.month.slice(0, 4)}
        {point.isPartial ? " (month to date)" : ""}
      </p>
      <div className="mt-1.5 space-y-0.5">
        <MonthlyTooltipRow
          label="Booked revenue"
          value={point.bookedSalesCents == null ? "—" : dollars(point.bookedSalesCents)}
        />
        <MonthlyTooltipRow
          label="Meta spend"
          value={point.metaSpendCents == null ? "—" : dollars(point.metaSpendCents)}
        />
      </div>
    </div>
  );
}

function MetaLeadMixTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: GrowthReturnChartPoint }>;
}) {
  const point = growthReturnTooltipPoint(active, payload);
  if (!point || point.isFuture) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-slate-900">
        {monthName(point.month)} {point.month.slice(0, 4)}
        {point.isPartial ? " (month to date)" : ""}
      </p>
      <div className="mt-1.5 space-y-0.5">
        <MonthlyTooltipRow label="Meta spend" value={point.metaSpendCents == null ? "—" : dollars(point.metaSpendCents)} />
        <MonthlyTooltipRow label="All leads" value={String(point.leads ?? 0)} />
        <MonthlyTooltipRow label="Meta leads" value={String(point.metaLeads ?? 0)} />
        <MonthlyTooltipRow label="Organic / other" value={String(point.organicOtherLeads ?? 0)} />
        <MonthlyTooltipRow label="Meta share" value={point.metaLeadSharePct == null ? "—" : `${point.metaLeadSharePct.toFixed(1)}%`} />
        <MonthlyTooltipRow label="Meta CPL" value={point.metaCostPerLeadCents == null ? "—" : dollars(point.metaCostPerLeadCents)} />
      </div>
    </div>
  );
}

function AcceptedJobsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: GrowthReturnChartPoint }>;
}) {
  const point = growthReturnTooltipPoint(active, payload);
  if (!point || point.isFuture) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-slate-900">
        {monthName(point.month)} {point.month.slice(0, 4)}
        {point.isPartial ? " (month to date)" : ""}
      </p>
      <div className="mt-1.5 space-y-0.5">
        <MonthlyTooltipRow label="Meta spend" value={point.metaSpendCents == null ? "—" : dollars(point.metaSpendCents)} />
        <MonthlyTooltipRow label="All jobs accepted" value={String(point.acceptedJobs ?? 0)} />
        <MonthlyTooltipRow label="Meta jobs" value={String(point.metaAcceptedJobs ?? 0)} />
        <MonthlyTooltipRow label="Organic / other" value={String(point.organicOtherAcceptedJobs ?? 0)} />
        <MonthlyTooltipRow label="Meta share" value={point.metaAcceptedSharePct == null ? "—" : `${point.metaAcceptedSharePct.toFixed(1)}%`} />
      </div>
    </div>
  );
}

function BookedSalesMixTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: GrowthReturnChartPoint }>;
}) {
  const point = growthReturnTooltipPoint(active, payload);
  if (!point || point.isFuture) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-slate-900">
        {monthName(point.month)} {point.month.slice(0, 4)}
        {point.isPartial ? " (month to date)" : ""}
      </p>
      <div className="mt-1.5 space-y-0.5">
        <MonthlyTooltipRow label="Meta spend" value={point.metaSpendCents == null ? "—" : dollars(point.metaSpendCents)} />
        <MonthlyTooltipRow label="All booked sales" value={point.bookedSalesCents == null ? "—" : dollars(point.bookedSalesCents)} />
        <MonthlyTooltipRow label="Meta booked sales" value={point.metaBookedRevenueCents == null ? "—" : dollars(point.metaBookedRevenueCents)} />
        <MonthlyTooltipRow label="Organic / other" value={point.bookedSalesCents == null || point.metaBookedRevenueCents == null ? "—" : dollars(Math.max(point.bookedSalesCents - point.metaBookedRevenueCents, 0))} />
        <MonthlyTooltipRow label="Meta share" value={point.metaBookedSalesSharePct == null ? "—" : `${point.metaBookedSalesSharePct.toFixed(1)}%`} />
      </div>
    </div>
  );
}

function BookedRoasTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: GrowthReturnChartPoint }>;
}) {
  const point = growthReturnTooltipPoint(active, payload);
  if (!point || point.isFuture) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-slate-900">
        {monthName(point.month)} {point.month.slice(0, 4)}
        {point.isPartial ? " (month to date)" : ""}
      </p>
      <div className="mt-1.5 space-y-0.5">
        <MonthlyTooltipRow label="Meta spend" value={point.metaSpendCents == null ? "—" : dollars(point.metaSpendCents)} />
        <MonthlyTooltipRow label="Meta booked sales" value={point.metaBookedRevenueCents == null ? "—" : dollars(point.metaBookedRevenueCents)} />
        <MonthlyTooltipRow label="Booked ROAS" value={point.bookedRoas == null ? "—" : `${point.bookedRoas.toFixed(2)}x`} />
      </div>
    </div>
  );
}

type Comparison = {
  current: number;
  previous: number;
  change: number;
  percentChange: number;
};

function DeltaChip({
  comparison,
  goodWhenDown = false,
}: {
  comparison: Comparison;
  goodWhenDown?: boolean;
}) {
  const up = comparison.change >= 0;
  const good = goodWhenDown ? !up : up;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      }`}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {formatPercent(Math.abs(comparison.percentChange))}
    </span>
  );
}

function KpiCard({
  label,
  value,
  comparison,
  previousLabel,
  goodWhenDown,
}: {
  label: string;
  value: string;
  comparison: Comparison;
  previousLabel: string;
  goodWhenDown?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-slate-500">{label}</p>
        <DeltaChip comparison={comparison} goodWhenDown={goodWhenDown} />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-400">was {previousLabel}</p>
    </div>
  );
}

function RateKpiCard({
  label,
  numerator,
  denominator,
  numeratorLabel,
  denominatorLabel,
  context,
}: {
  label: string;
  numerator: Comparison;
  denominator: Comparison;
  numeratorLabel: string;
  denominatorLabel: string;
  context?: string;
}) {
  const rate = (value: number, total: number) =>
    total > 0 ? (value / total) * 100 : 0;
  const current = rate(numerator.current, denominator.current);
  const previous = rate(numerator.previous, denominator.previous);
  const deltaPoints = current - previous;
  const improved = deltaPoints >= 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-slate-500">{label}</p>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            improved
              ? "bg-emerald-50 text-emerald-700"
              : "bg-rose-50 text-rose-700"
          }`}
        >
          <span aria-hidden>{improved ? "▲" : "▼"}</span>
          {Math.abs(deltaPoints).toFixed(1)} pts
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
        {current.toFixed(1)}%
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {numerator.current} {numeratorLabel} / {denominator.current} {denominatorLabel}
      </p>
      <p className="mt-0.5 text-xs text-slate-400">
        was {previous.toFixed(1)}% ({numerator.previous} / {denominator.previous})
      </p>
      {context ? <p className="mt-1 text-xs text-slate-400">{context}</p> : null}
    </div>
  );
}

function PathCard({
  title,
  accent,
  path,
}: {
  title: string;
  accent: string;
  path: {
    leads: number;
    proposals: number;
    acceptedJobs: number;
    acceptanceRate: number;
    bookedRevenueCents: number;
  };
}) {
  const rate = asPercent(path.acceptanceRate);
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">{title}</p>
        <p className="text-sm font-semibold text-slate-900">
          {dollars(path.bookedRevenueCents)}
        </p>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${accent}`}
          style={{ width: `${Math.min(rate, 100)}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>
          {path.acceptedJobs} accepted jobs / {path.proposals} proposals
        </span>
        <span className="font-medium text-slate-700">{rate.toFixed(1)}% same-period ratio</span>
      </div>
    </div>
  );
}

export function ClaudeConcept1({ pulse }: { pulse: MetricsConceptPulse }) {
  const { activity, economics, appointments } = pulse;

  const funnelData = [
    {
      stage: "Contacts created",
      current: activity.setRateContacts.current,
      previous: activity.setRateContacts.previous,
    },
    {
      stage: "Booked contacts",
      current: activity.setRateBookedContacts.current,
      previous: activity.setRateBookedContacts.previous,
    },
    {
      stage: "Qualified proposals",
      current: activity.proposals.current,
      previous: activity.proposals.previous,
    },
    {
      stage: "Accepted proposals",
      current: activity.acceptedProposals.current,
      previous: activity.acceptedProposals.previous,
    },
  ];

  const metaAcceptedJobs = economics.metaAcceptedJobs;
  const otherAcceptedJobs = Math.max(economics.acceptedJobs - metaAcceptedJobs, 0);
  const acceptedJobSourceData = [
    { name: "Meta ads", value: metaAcceptedJobs, fill: "#0ea5e9" },
    { name: "Other sources", value: otherAcceptedJobs, fill: "#cbd5e1" },
  ];

  const appointmentLiftPts =
    asPercent(appointments.withAppointment.acceptanceRate) -
    asPercent(appointments.withoutAppointment.acceptanceRate);
  const monthlyYear = pulse.asOf.slice(0, 4);
  const monthlyPoints = new Map(pulse.monthly.map((point) => [point.month, point]));
  const monthlyData: GrowthReturnChartPoint[] = Array.from(
    { length: 12 },
    (_, index) => {
      const month = `${monthlyYear}-${String(index + 1).padStart(2, "0")}`;
      const point = monthlyPoints.get(month);
      if (!point) {
        return {
          month,
          label: monthName(month),
          isPartial: false,
          isFuture: true,
          bookedSalesDollars: null,
          metaSpendDollars: null,
          leads: null,
          appointments: null,
          setRatePct: null,
          setRateContacts: null,
          setRateBookedContacts: null,
          setRateBasis: null,
          proposalRatePct: null,
          closingRatePct: null,
          closingBasis: null,
          bookedJobsInLeadBar: null,
          leadsNotBooked: null,
          bookedSalesCents: null,
          metaSpendCents: null,
          metaSpendSource: null,
          metaCostPerLeadCents: null,
          proposals: null,
          acceptedProposals: null,
          jobsWon: null,
          acceptedJobs: null,
          blendedCacCents: null,
          bookedRoas: null,
          metaLeads: null,
          organicOtherLeads: null,
          metaLeadSharePct: null,
          metaAcceptedJobs: null,
          organicOtherAcceptedJobs: null,
          metaAcceptedSharePct: null,
          metaBookedSalesDollars: null,
          organicOtherBookedSalesDollars: null,
          metaBookedRevenueCents: null,
          metaBookedSalesSharePct: null,
        };
      }
      return {
        month,
        label: point.isPartial ? `${monthName(month)}*` : monthName(month),
        isPartial: point.isPartial,
        isFuture: false,
        bookedSalesDollars: point.bookedSalesCents / 100,
        metaSpendDollars: point.metaSpendCents / 100,
        leads: point.leads,
        appointments: point.appointments,
        setRatePct: point.setRate == null ? null : asPercent(point.setRate),
        setRateContacts: point.setRateContacts,
        setRateBookedContacts: point.setRateBookedContacts,
        setRateBasis: point.setRateBasis,
        proposalRatePct:
          point.proposalRate == null ? null : asPercent(point.proposalRate),
        closingRatePct:
          point.acceptedRate == null ? null : asPercent(point.acceptedRate),
        closingBasis: point.closingBasis,
        bookedJobsInLeadBar: Math.min(point.acceptedJobs, point.leads),
        leadsNotBooked: Math.max(point.leads - point.acceptedJobs, 0),
        bookedSalesCents: point.bookedSalesCents,
        metaSpendCents: point.metaSpendCents,
        metaSpendSource: point.metaSpendSource,
        metaCostPerLeadCents: point.metaCostPerLeadCents,
        proposals: point.proposals,
        acceptedProposals: point.acceptedProposals,
        jobsWon: point.jobsWon,
        acceptedJobs: point.acceptedJobs,
        blendedCacCents: point.blendedCacCents,
        bookedRoas: point.bookedRoas,
        metaLeads: point.paidSocialLeads,
        organicOtherLeads: Math.max(point.leads - point.paidSocialLeads, 0),
        metaLeadSharePct:
          point.leads > 0 ? (point.paidSocialLeads / point.leads) * 100 : null,
        metaAcceptedJobs: point.metaAcceptedJobs,
        organicOtherAcceptedJobs: Math.max(
          point.acceptedJobs - point.metaAcceptedJobs,
          0,
        ),
        metaAcceptedSharePct:
          point.acceptedJobs > 0
            ? (point.metaAcceptedJobs / point.acceptedJobs) * 100
            : null,
        metaBookedSalesDollars: point.metaBookedRevenueCents / 100,
        organicOtherBookedSalesDollars:
          Math.max(point.bookedSalesCents - point.metaBookedRevenueCents, 0) / 100,
        metaBookedRevenueCents: point.metaBookedRevenueCents,
        metaBookedSalesSharePct:
          point.bookedSalesCents > 0
            ? (point.metaBookedRevenueCents / point.bookedSalesCents) * 100
            : null,
      };
    },
  );

  return (
    <div className="space-y-4">
      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard
          label={activity.salesBasis === "dripjobs_gross_sales" ? "DripJobs sales · incl. HST" : "Booked sales · before HST"}
          value={dollars(activity.salesCents.current)}
          previousLabel={dollars(activity.salesCents.previous)}
          comparison={activity.salesCents}
        />
        <KpiCard
          label="Leads produced"
          value={activity.leads.current.toLocaleString("en-CA")}
          previousLabel={activity.leads.previous.toLocaleString("en-CA")}
          comparison={activity.leads}
        />
        <RateKpiCard
          label={
            activity.setRateBasis === "dripjobs_contact_cohort"
              ? "Set rate · DripJobs cohort"
              : "Set rate · imported cohort"
          }
          numerator={activity.setRateBookedContacts}
          denominator={activity.setRateContacts}
          numeratorLabel="booked contacts"
          denominatorLabel="contacts"
        />
        <RateKpiCard
          label={
            activity.closingBasis === "dripjobs_qualified_proposal_cohort"
              ? "Qualified proposal rate · DripJobs"
              : "Qualified proposal rate · imported"
          }
          numerator={activity.proposals}
          denominator={activity.setRateContacts}
          numeratorLabel="qualified proposals"
          denominatorLabel="contacts"
        />
        <RateKpiCard
          label={closingRateLabel(activity.closingBasis)}
          numerator={activity.acceptedProposals}
          denominator={activity.proposals}
          numeratorLabel="accepted proposals"
          denominatorLabel="qualified proposals"
          context={`Jobs Won: ${activity.jobsWon.current} · was ${activity.jobsWon.previous} · accepted proposals in period regardless of sent date`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Funnel vs prior period */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Conversion cohorts vs prior period
            </h3>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />
                Current
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />
                Previous
              </span>
            </div>
          </div>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} barGap={6}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="stage"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: "#64748b" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={32}
                  tick={{ fontSize: 12, fill: "#94a3b8" }}
                />
                <Tooltip
                  cursor={{ fill: "#f8fafc" }}
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="current" name="Current" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                <Bar dataKey="previous" name="Previous" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Set rate pairs booked contacts with contacts created. Closing ratio pairs accepted
            proposals with the same qualified-proposal cohort. Jobs Won: {activity.jobsWon.current}
            {" "}(was {activity.jobsWon.previous}) is separate and can include proposals sent earlier.
          </p>
        </div>

        {/* Meta ads economics */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Meta ads payoff</h3>
          <div className="relative mt-2 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={acceptedJobSourceData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={68}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {acceptedJobSourceData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-xl font-semibold text-slate-900">
                {economics.bookedRoas.toFixed(2)}x
              </p>
              <p className="text-xs text-slate-400">booked ROAS</p>
            </div>
          </div>
          <p className="mt-1 text-center text-xs text-slate-500">
            {metaAcceptedJobs} of {economics.acceptedJobs} operational jobs accepted came from Meta ads
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="flex justify-between gap-2 border-t border-slate-100 pt-2">
              <dt className="text-slate-500">
                Spend ({spendSourceLabel(economics.metaSpendSource)})
              </dt>
              <dd className="font-medium text-slate-900">
                {dollars(economics.metaSpendCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-2 border-t border-slate-100 pt-2">
              <dt className="text-slate-500">Booked</dt>
              <dd className="font-medium text-slate-900">
                {dollars(economics.metaBookedRevenueCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-2 border-t border-slate-100 pt-2">
              <dt className="text-slate-500">Meta CAC</dt>
              <dd className="font-medium text-slate-900">
                {dollars(economics.metaCacCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-2 border-t border-slate-100 pt-2">
              <dt className="text-slate-500">Blended CAC</dt>
              <dd className="font-medium text-slate-900">
                {dollars(economics.blendedCacCents)}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Appointment impact */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Do appointments correlate with accepted jobs?
          </h3>
          <p className="text-xs text-slate-500">
            Appointments lift the same-period accepted-job ratio by{" "}
            <span className="font-semibold text-emerald-700">
              {appointmentLiftPts.toFixed(1)} pts
            </span>
            ; {formatPercent(appointments.acceptedWithoutAppointmentShare)} of accepted jobs
            had no recorded appointment
          </p>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <PathCard
            title="With appointment"
            accent="bg-emerald-500"
            path={appointments.withAppointment}
          />
          <PathCard
            title="No appointment"
            accent="bg-amber-400"
            path={appointments.withoutAppointment}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {monthlyYear} Growth &amp; Return
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              When we spend more, do we receive more leads and win more revenue?
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-sky-500" />
              Booked sales · left $
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-amber-500" />
              Meta spend · right $
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
              Booked jobs
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-indigo-200" />
              Leads not booked
            </span>
          </div>
        </div>
        <div className="mt-5 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthlyData} margin={{ top: 18, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: "#64748b" }}
              />
              <YAxis
                yAxisId="dollars"
                tickLine={false}
                axisLine={false}
                width={52}
                tick={{ fontSize: 12, fill: "#0ea5e9" }}
                tickFormatter={compactDollars}
              />
              <YAxis
                yAxisId="metaSpend"
                orientation="right"
                tickLine={false}
                axisLine={false}
                width={48}
                tick={{ fontSize: 12, fill: "#d97706" }}
                tickFormatter={compactDollars}
              />
              <YAxis
                yAxisId="leads"
                hide
                allowDecimals={false}
              />
              <Tooltip cursor={{ fill: "#f8fafc" }} content={<GrowthReturnTooltip />} />
              <Bar
                yAxisId="leads"
                dataKey="bookedJobsInLeadBar"
                name="Booked jobs"
                stackId="leadOutcome"
                fill="#10b981"
                maxBarSize={44}
              >
                <LabelList
                  dataKey="bookedJobsInLeadBar"
                  position="insideTop"
                  fill="#ffffff"
                  fontSize={11}
                  fontWeight={600}
                />
              </Bar>
              <Bar
                yAxisId="leads"
                dataKey="leadsNotBooked"
                name="Leads not booked"
                stackId="leadOutcome"
                fill="#c7d2fe"
                radius={[4, 4, 0, 0]}
                maxBarSize={44}
              >
                <LabelList
                  dataKey="leads"
                  position="top"
                  fill="#6366f1"
                  fontSize={11}
                />
              </Bar>
              <Line
                yAxisId="dollars"
                type="monotone"
                dataKey="bookedSalesDollars"
                name="Booked sales"
                stroke="#0ea5e9"
                strokeWidth={3}
                connectNulls={false}
                dot={{ r: 4, fill: "#0ea5e9", stroke: "#ffffff", strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              />
              <Line
                yAxisId="metaSpend"
                type="monotone"
                dataKey="metaSpendDollars"
                name="Meta spend"
                stroke="#f59e0b"
                strokeWidth={3}
                connectNulls={false}
                dot={{ r: 4, fill: "#f59e0b", stroke: "#ffffff", strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          Booked sales and booked-job bars use jobs accepted that month; revenue excludes HST.
          Lead bars compare same-month activity, not a lead-created cohort. * current month to date;
          future months are intentionally blank.
        </p>
      </div>

      <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {monthlyYear} Meta Spend vs Booked Revenue
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Two dollar scales make the smaller advertising trend visible.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-sky-500" />
              Booked revenue · left axis
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-amber-400" />
              Meta spend · right axis
            </span>
          </div>
        </div>
        <div className="mt-5 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthlyData} margin={{ top: 18, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: "#64748b" }}
              />
              <YAxis
                yAxisId="revenue"
                domain={[0, "auto"]}
                tickLine={false}
                axisLine={false}
                width={56}
                tick={{ fontSize: 12, fill: "#0284c7" }}
                tickFormatter={compactDollars}
              />
              <YAxis
                yAxisId="spend"
                orientation="right"
                domain={[0, "auto"]}
                tickLine={false}
                axisLine={false}
                width={56}
                tick={{ fontSize: 12, fill: "#d97706" }}
                tickFormatter={compactDollars}
              />
              <Tooltip content={<SpendRevenueTooltip />} />
              <Line
                yAxisId="spend"
                type="monotone"
                dataKey="metaSpendDollars"
                name="Meta spend"
                stroke="#f59e0b"
                strokeWidth={3}
                connectNulls={false}
                dot={{ r: 4, fill: "#f59e0b", strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
              <Line
                yAxisId="revenue"
                type="monotone"
                dataKey="bookedSalesDollars"
                name="Booked revenue"
                stroke="#0ea5e9"
                strokeWidth={3}
                connectNulls={false}
                dot={{ r: 4, fill: "#0ea5e9", strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          Left axis: booked revenue before HST. Right axis: Meta spend. Compare the direction and
          month-to-month movement—not the lines’ vertical distance, because each uses a different
          scale. * current month to date; future months are blank.
        </p>
      </div>

      <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {monthlyYear} Funnel Health
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Are we converting better, or only spending more?
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-sky-500" />
              Set rate
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-violet-500" />
              Qualified proposal rate
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-emerald-500" />
              Closing ratio
            </span>
          </div>
        </div>
        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthlyData} margin={{ top: 18, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: "#64748b" }}
              />
              <YAxis
                domain={[
                  0,
                  (dataMax: number) =>
                    Math.max(100, Math.ceil(dataMax / 10) * 10),
                ]}
                tickLine={false}
                axisLine={false}
                width={42}
                tick={{ fontSize: 12, fill: "#94a3b8" }}
                tickFormatter={(value: number) => `${value}%`}
              />
              <Tooltip content={<FunnelHealthTooltip />} />
              <Line
                type="monotone"
                dataKey="setRatePct"
                name="Set rate"
                stroke="#0ea5e9"
                strokeWidth={3}
                connectNulls={false}
                dot={{ r: 4, fill: "#0ea5e9", strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="proposalRatePct"
                name="Qualified proposal rate"
                stroke="#8b5cf6"
                strokeWidth={3}
                connectNulls={false}
                dot={{ r: 4, fill: "#8b5cf6", strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="closingRatePct"
                name="Closing ratio"
                stroke="#10b981"
                strokeWidth={3}
                connectNulls={false}
                dot={{ r: 4, fill: "#10b981", strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          Set rate uses booked contacts ÷ contacts created. Qualified proposal rate uses qualified
          proposals ÷ contacts. Closing ratio uses accepted proposals from that exact
          qualified-proposal cohort ÷ qualified proposals. Validated DripJobs snapshots are used when
          available; imported reports fill other periods. Jobs Won remains separate and can include
          proposals sent earlier. * current month to date; future months are intentionally blank.
        </p>
      </div>

      <div className="grid gap-4 lg:col-span-2 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="lg:min-h-[92px]">
            <h3 className="text-sm font-semibold text-slate-900">
              {monthlyYear} Meta spend and lead mix
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Does more ad spend increase Meta leads and their share of all leads?
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-amber-400" />Meta spend</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />Meta leads</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />Organic / other</span>
            </div>
          </div>
          <div className="mt-5 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyData} margin={{ top: 18, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis yAxisId="dollars" tickLine={false} axisLine={false} width={52} tick={{ fontSize: 12, fill: "#94a3b8" }} tickFormatter={compactDollars} />
                <YAxis yAxisId="count" orientation="right" tickLine={false} axisLine={false} width={32} allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                <Tooltip cursor={{ fill: "#f8fafc" }} content={<MetaLeadMixTooltip />} />
                <Bar yAxisId="count" dataKey="metaLeads" name="Meta leads" stackId="leads" fill="#0ea5e9" maxBarSize={64} />
                <Bar yAxisId="count" dataKey="organicOtherLeads" name="Organic / other leads" stackId="leads" fill="#cbd5e1" radius={[4, 4, 0, 0]} maxBarSize={64}>
                  <LabelList dataKey="metaLeadSharePct" position="top" fill="#64748b" fontSize={11} formatter={(value: number) => `${Math.round(value)}% Meta`} />
                </Bar>
                <Line yAxisId="dollars" type="monotone" dataKey="metaSpendDollars" name="Meta spend" stroke="#f59e0b" strokeWidth={3} connectNulls={false} dot={{ r: 4, fill: "#f59e0b", strokeWidth: 0 }} activeDot={{ r: 6 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Percent labels show Meta leads as a share of all leads. * current month to date.
          </p>
        </div>

        <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="lg:min-h-[92px]">
            <h3 className="text-sm font-semibold text-slate-900">
              {monthlyYear} Meta spend and accepted job mix
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Does more ad spend change how many jobs are accepted and where they came from?
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-amber-400" />Meta spend</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />Meta jobs</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />Organic / other</span>
            </div>
          </div>
          <div className="mt-5 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyData} margin={{ top: 18, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis yAxisId="dollars" tickLine={false} axisLine={false} width={52} tick={{ fontSize: 12, fill: "#94a3b8" }} tickFormatter={compactDollars} />
                <YAxis yAxisId="accepted" orientation="right" tickLine={false} axisLine={false} width={36} allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                <Tooltip cursor={{ fill: "#f8fafc" }} content={<AcceptedJobsTooltip />} />
                <Bar yAxisId="accepted" dataKey="metaAcceptedJobs" name="Meta jobs accepted" stackId="accepted" fill="#0ea5e9" maxBarSize={64} />
                <Bar yAxisId="accepted" dataKey="organicOtherAcceptedJobs" name="Organic / other jobs" stackId="accepted" fill="#cbd5e1" radius={[4, 4, 0, 0]} maxBarSize={64}>
                  <LabelList dataKey="metaAcceptedSharePct" position="top" fill="#64748b" fontSize={11} formatter={(value: number) => `${Math.round(value)}% Meta`} />
                </Bar>
                <Line yAxisId="dollars" type="monotone" dataKey="metaSpendDollars" name="Meta spend" stroke="#f59e0b" strokeWidth={3} connectNulls={false} dot={{ r: 4, fill: "#f59e0b", strokeWidth: 0 }} activeDot={{ r: 6 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Jobs are grouped by acceptance month and split by lead source. * current month to date.
          </p>
        </div>

        <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="lg:min-h-[92px]">
            <h3 className="text-sm font-semibold text-slate-900">
              {monthlyYear} Meta spend and booked sales mix
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Does more ad spend change booked sales and the share produced by Meta?
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-amber-400" />Meta spend</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />Meta sales</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />Organic / other</span>
            </div>
          </div>
          <div className="mt-5 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyData} margin={{ top: 18, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis yAxisId="spend" tickLine={false} axisLine={false} width={52} tick={{ fontSize: 12, fill: "#94a3b8" }} tickFormatter={compactDollars} />
                <YAxis yAxisId="sales" orientation="right" tickLine={false} axisLine={false} width={52} tick={{ fontSize: 12, fill: "#94a3b8" }} tickFormatter={compactDollars} />
                <Tooltip cursor={{ fill: "#f8fafc" }} content={<BookedSalesMixTooltip />} />
                <Bar yAxisId="sales" dataKey="metaBookedSalesDollars" name="Meta booked sales" stackId="sales" fill="#0ea5e9" maxBarSize={64} />
                <Bar yAxisId="sales" dataKey="organicOtherBookedSalesDollars" name="Organic / other sales" stackId="sales" fill="#cbd5e1" radius={[4, 4, 0, 0]} maxBarSize={64}>
                  <LabelList dataKey="metaBookedSalesSharePct" position="top" fill="#64748b" fontSize={11} formatter={(value: number) => `${Math.round(value)}% Meta`} />
                </Bar>
                <Line yAxisId="spend" type="monotone" dataKey="metaSpendDollars" name="Meta spend" stroke="#f59e0b" strokeWidth={3} connectNulls={false} dot={{ r: 4, fill: "#f59e0b", strokeWidth: 0 }} activeDot={{ r: 6 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Sales are grouped by acceptance month, exclude HST, and are split by lead source.
          </p>
        </div>

        <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="lg:min-h-[92px]">
            <h3 className="text-sm font-semibold text-slate-900">
              {monthlyYear} Meta spend and booked ROAS
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              How much Meta-sourced booked sales came back for every $1 spent?
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-amber-400" />Meta spend</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Booked ROAS</span>
            </div>
          </div>
          <div className="mt-5 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyData} margin={{ top: 18, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis yAxisId="spend" tickLine={false} axisLine={false} width={52} tick={{ fontSize: 12, fill: "#94a3b8" }} tickFormatter={compactDollars} />
                <YAxis yAxisId="roas" orientation="right" tickLine={false} axisLine={false} width={36} tick={{ fontSize: 12, fill: "#94a3b8" }} tickFormatter={(value: number) => `${value}x`} />
                <Tooltip cursor={{ fill: "#f8fafc" }} content={<BookedRoasTooltip />} />
                <Bar yAxisId="roas" dataKey="bookedRoas" name="Booked ROAS" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={64}>
                  <LabelList dataKey="bookedRoas" position="top" fill="#64748b" fontSize={11} formatter={(value: number) => `${value.toFixed(1)}x`} />
                </Bar>
                <Line yAxisId="spend" type="monotone" dataKey="metaSpendDollars" name="Meta spend" stroke="#f59e0b" strokeWidth={3} connectNulls={false} dot={{ r: 4, fill: "#f59e0b", strokeWidth: 0 }} activeDot={{ r: 6 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            ROAS uses Meta-sourced booked sales ÷ Meta spend. Revenue excludes HST; ROAS is not profit.
          </p>
        </div>
      </div>

      </div>
    </div>
  );
}
