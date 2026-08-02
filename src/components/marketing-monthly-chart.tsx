"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MarketingMonthlyMetric } from "@/lib/marketing";

const cad = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

const integer = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

function monthLabel(month: string) {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    month: "short",
  });
}

type ChartRow = {
  label: string;
  metaLeads: number;
  crmPaidSocial: number;
  wonJobs: number;
  bankSpend: number;
  exactDates: number;
  estimatedDates: number;
};

const SERIES: Array<{ key: keyof ChartRow; name: string }> = [
  { key: "metaLeads", name: "Meta customer leads" },
  { key: "crmPaidSocial", name: "CRM paid-social records" },
  { key: "wonJobs", name: "Won jobs" },
  { key: "bankSpend", name: "Bank spend (CAD)" },
];

function MonthlyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | string; payload?: ChartRow }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs shadow-md"
      style={{ boxShadow: "var(--shadow)" }}
    >
      <div className="font-semibold text-[var(--color-heading)]">{label}</div>
      <dl className="mt-1.5 space-y-1">
        <div className="flex justify-between gap-6">
          <dt className="text-[var(--color-muted)]">Meta customer leads</dt>
          <dd className="tabular-nums font-medium">{integer.format(row.metaLeads)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-[var(--color-muted)]">CRM paid-social records</dt>
          <dd className="tabular-nums font-medium">{integer.format(row.crmPaidSocial)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-[var(--color-muted)]">Won jobs (all sources)</dt>
          <dd className="tabular-nums font-medium">{integer.format(row.wonJobs)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-[var(--color-muted)]">Bank spend</dt>
          <dd className="tabular-nums font-medium">{cad.format(row.bankSpend)}</dd>
        </div>
      </dl>
      <div className="mt-1.5 border-t border-[var(--color-border)] pt-1.5 text-[11px] text-[var(--color-muted)]">
        CRM lead dates: {integer.format(row.exactDates)} exact ·{" "}
        {integer.format(row.estimatedDates)} estimated
      </div>
    </div>
  );
}

export function MarketingMonthlyChart({
  monthly,
}: {
  monthly: MarketingMonthlyMetric[];
}) {
  const data: ChartRow[] = monthly.map((row) => ({
    label: monthLabel(row.month),
    metaLeads: row.metaCustomerLeads,
    crmPaidSocial: row.crmPaidSocialRecords,
    wonJobs: row.wonJobs,
    bankSpend: row.bankSpendCad,
    exactDates: row.exactLeadDates,
    estimatedDates: row.estimatedLeadDates,
  }));

  const hasData = data.some(
    (row) => row.metaLeads || row.crmPaidSocial || row.wonJobs || row.bankSpend,
  );
  if (!hasData) {
    return (
      <div className="px-5 py-12 text-center text-sm text-[var(--color-muted)]">
        No monthly marketing activity recorded for this year.
      </div>
    );
  }

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        Monthly bars for Meta customer leads, CRM paid-social records, and won
        jobs, with a line for authoritative bank marketing spend in Canadian
        dollars.
      </figcaption>
      <div className="h-72 w-full px-2 pt-4" role="img" aria-label={SERIES.map((s) => s.name).join(", ") + " by month"}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--chart-grid)" }}
            />
            <YAxis
              yAxisId="counts"
              width={36}
              allowDecimals={false}
              tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              label={{
                value: "Leads / records",
                angle: -90,
                position: "insideLeft",
                style: { fill: "var(--chart-axis)", fontSize: 10 },
              }}
            />
            <YAxis
              yAxisId="spend"
              orientation="right"
              width={52}
              tickFormatter={(value: number) => cad.format(value)}
              tick={{ fill: "var(--chart-axis)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={<MonthlyTooltip />}
              cursor={{ fill: "var(--color-chip-muted)", opacity: 0.5 }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: "var(--color-muted)" }}
              iconSize={9}
            />
            <Bar
              yAxisId="counts"
              dataKey="metaLeads"
              name="Meta customer leads"
              fill="var(--color-brand)"
              radius={[2, 2, 0, 0]}
              maxBarSize={18}
            />
            <Bar
              yAxisId="counts"
              dataKey="crmPaidSocial"
              name="CRM paid-social records"
              fill="var(--color-brand-strong)"
              fillOpacity={0.55}
              radius={[2, 2, 0, 0]}
              maxBarSize={18}
            />
            <Bar
              yAxisId="counts"
              dataKey="wonJobs"
              name="Won jobs (all sources)"
              fill="var(--color-good)"
              radius={[2, 2, 0, 0]}
              maxBarSize={18}
            />
            <Line
              yAxisId="spend"
              type="monotone"
              dataKey="bankSpend"
              name="Bank spend (CAD)"
              stroke="var(--color-heading)"
              strokeWidth={1.75}
              strokeDasharray="4 3"
              dot={{ r: 2.5, fill: "var(--color-heading)", strokeWidth: 0 }}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
