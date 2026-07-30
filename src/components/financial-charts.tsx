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

export type FinancialMonthPoint = {
  month: string;
  revenue: number;
  expenses: number;
  net: number;
};

const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});
const chartMargin = { top: 10, right: 8, left: 2, bottom: 0 };
const axisTick = { fill: "var(--chart-axis)", fontSize: 11 };
const valueAxisTick = { fill: "var(--chart-axis)", fontSize: 10 };
const axisLine = { stroke: "var(--chart-grid)" };
const tooltipContentStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  color: "var(--color-text)",
  fontSize: 12,
};
const tooltipLabelStyle = { color: "var(--color-muted)" };
const legendStyle = { color: "var(--color-muted)", fontSize: 11 };
const netDot = { r: 3, fill: "var(--color-good)", strokeWidth: 0 };

function formatAxisMoney(value: number) {
  return money.format(Number(value));
}

function formatTooltip(value: number, name: string) {
  return [
    money.format(value),
    name === "revenue" ? "Revenue" : name === "expenses" ? "Expenses" : "Net",
  ];
}

function formatLegend(value: string) {
  return value === "revenue" ? "Revenue" : value === "expenses" ? "Expenses" : "Net";
}

export function FinancialMonthlyChart({ data }: { data: FinancialMonthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={chartMargin}>
        <CartesianGrid
          vertical={false}
          stroke="var(--chart-grid)"
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="month"
          tick={axisTick}
          tickLine={false}
          axisLine={axisLine}
        />
        <YAxis
          width={68}
          tickFormatter={formatAxisMoney}
          tick={valueAxisTick}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={formatTooltip}
          contentStyle={tooltipContentStyle}
          labelStyle={tooltipLabelStyle}
        />
        <Legend
          formatter={formatLegend}
          wrapperStyle={legendStyle}
        />
        <Bar
          dataKey="revenue"
          fill="var(--color-brand)"
          radius={[4, 4, 0, 0]}
          maxBarSize={30}
        />
        <Bar
          dataKey="expenses"
          fill="var(--color-warn)"
          radius={[4, 4, 0, 0]}
          maxBarSize={30}
        />
        <Line
          type="monotone"
          dataKey="net"
          stroke="var(--color-good)"
          strokeWidth={2.5}
          dot={netDot}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
