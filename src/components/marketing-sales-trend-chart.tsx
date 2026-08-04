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
import type { MarketingTrendPoint } from "@/lib/marketing-sales-metrics";

const cad = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

const integer = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

function compactCad(value: number) {
  if (Math.abs(value) >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

type ChartRow = {
  month: string;
  label: string;
  leads: number;
  customers: number;
  jobs: number;
  booked: number;
  cash: number;
  spend: number | null;
};

function TrendTooltip({
  active,
  payload,
  label,
  revenueMode,
  hasSpend,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
  label?: string;
  revenueMode: "booked" | "cash";
  hasSpend: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const rows: Array<{ name: string; value: string; emphasis?: boolean }> = [
    { name: "Leads created", value: integer.format(row.leads) },
    { name: "Acquired customers", value: integer.format(row.customers) },
    { name: "Connected jobs", value: integer.format(row.jobs) },
    {
      name: "Booked revenue",
      value: cad.format(row.booked),
      emphasis: revenueMode === "booked",
    },
    {
      name: "Cash-backed revenue",
      value: cad.format(row.cash),
      emphasis: revenueMode === "cash",
    },
  ];
  if (hasSpend && row.spend != null) {
    rows.push({ name: "Bank Meta spend", value: cad.format(row.spend) });
  }
  return (
    <div
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs"
      style={{ boxShadow: "var(--shadow)" }}
    >
      <div className="font-semibold text-[var(--color-heading)]">{label}</div>
      <dl className="mt-1.5 space-y-1">
        {rows.map((item) => (
          <div key={item.name} className="flex justify-between gap-6">
            <dt className="text-[var(--color-muted)]">{item.name}</dt>
            <dd
              className={
                item.emphasis
                  ? "font-semibold tabular-nums text-[var(--color-heading)]"
                  : "font-medium tabular-nums"
              }
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Two stacked month panels sharing the same x-axis: lead-cohort counts on top,
 * CAD money below. Counts and dollars never share an axis, and revenue and
 * verified bank spend live on one CAD scale so they compare honestly.
 */
export function MarketingSalesTrendChart({
  trend,
  revenueMode,
  hasSpend,
}: {
  trend: MarketingTrendPoint[];
  revenueMode: "booked" | "cash";
  hasSpend: boolean;
}) {
  const spansYears = new Set(trend.map((row) => row.month.slice(0, 4))).size > 1;
  const data: ChartRow[] = trend.map((row) => ({
    month: row.month,
    label: new Date(`${row.month}-01T12:00:00Z`).toLocaleDateString("en-CA", {
      timeZone: "UTC",
      month: "short",
      ...(spansYears ? { year: "2-digit" as const } : {}),
    }),
    leads: row.leads,
    customers: row.customers,
    jobs: row.jobs,
    booked: row.bookedRevenueBeforeHst,
    cash: row.cashRevenueBeforeHst,
    spend: row.spendCad,
  }));

  const hasActivity = data.some(
    (row) => row.leads || row.jobs || row.booked || row.cash || row.spend,
  );
  if (!hasActivity) {
    return (
      <div className="px-5 py-12 text-center text-sm text-[var(--color-muted)]">
        No lead, revenue, or spend activity in this range.
      </div>
    );
  }

  const revenueName =
    revenueMode === "booked"
      ? "Booked revenue (before HST)"
      : "Cash-backed revenue (before HST)";

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        Monthly trend by lead-created month: leads and acquired customers on a
        count scale, then {revenueName.toLowerCase()}
        {hasSpend ? " and bank-verified Meta spend" : ""} in Canadian dollars.
      </figcaption>
      <div className="px-2 pt-3">
        <div className="h-44 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
              barGap={2}
            >
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--chart-grid)" }}
              />
              <YAxis
                width={34}
                allowDecimals={false}
                tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={
                  <TrendTooltip revenueMode={revenueMode} hasSpend={hasSpend} />
                }
                cursor={{ fill: "var(--color-chip-muted)", opacity: 0.5 }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: "var(--color-muted)" }}
                iconSize={9}
              />
              <Bar
                dataKey="leads"
                name="Leads created"
                fill="var(--color-brand)"
                radius={[3, 3, 0, 0]}
                maxBarSize={20}
              />
              <Bar
                dataKey="customers"
                name="Acquired customers"
                fill="var(--color-good)"
                radius={[3, 3, 0, 0]}
                maxBarSize={20}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="h-44 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
              barGap={2}
            >
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--chart-grid)" }}
              />
              <YAxis
                width={44}
                tickFormatter={compactCad}
                tick={{ fill: "var(--chart-axis)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={
                  <TrendTooltip revenueMode={revenueMode} hasSpend={hasSpend} />
                }
                cursor={{ fill: "var(--color-chip-muted)", opacity: 0.5 }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: "var(--color-muted)" }}
                iconSize={9}
              />
              <Bar
                dataKey={revenueMode === "booked" ? "booked" : "cash"}
                name={revenueName}
                fill="var(--color-brand-strong)"
                radius={[3, 3, 0, 0]}
                maxBarSize={20}
              />
              {hasSpend ? (
                <Line
                  type="monotone"
                  dataKey="spend"
                  name="Bank Meta spend (CAD)"
                  stroke="var(--color-heading)"
                  strokeWidth={1.75}
                  strokeDasharray="4 3"
                  dot={{ r: 2.5, fill: "var(--color-heading)", strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <table className="sr-only">
        <caption>
          Monthly leads, acquired customers, connected jobs, revenue, and
          bank-verified Meta spend for the selected lead cohort.
        </caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Leads</th>
            <th scope="col">Customers</th>
            <th scope="col">Jobs</th>
            <th scope="col">Booked revenue</th>
            <th scope="col">Cash-backed revenue</th>
            <th scope="col">Bank Meta spend</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.month}>
              <th scope="row">{row.month}</th>
              <td>{integer.format(row.leads)}</td>
              <td>{integer.format(row.customers)}</td>
              <td>{integer.format(row.jobs)}</td>
              <td>{cad.format(row.booked)}</td>
              <td>{cad.format(row.cash)}</td>
              <td>{row.spend == null ? "—" : cad.format(row.spend)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
