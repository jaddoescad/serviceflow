"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// CSS variables resolve inside inline SVG/DOM, so Recharts re-skins per theme.
const COLORS = {
  onSite: "var(--color-brand)",
  offSite: "var(--color-warn)",
  bar: "var(--color-brand)",
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  approved: "var(--color-good)",
  pending: "var(--color-warn)",
  good: "var(--color-good)",
  near: "var(--color-warn)",
  over: "var(--color-bad)",
  track: "var(--color-chip-muted)",
};

const axisProps = {
  stroke: COLORS.axis,
  tick: { fill: COLORS.axis, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: COLORS.grid },
};

const tooltipStyle = {
  contentStyle: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--color-text)",
  },
  labelStyle: { color: "var(--color-muted)" },
  itemStyle: { color: "var(--color-text)" },
} as const;

function shortDay(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export function HoursByDayChart({
  data,
}: {
  data: { day: string; onSite: number; offSite: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="onSiteFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.onSite} stopOpacity={0.5} />
            <stop offset="100%" stopColor={COLORS.onSite} stopOpacity={0.03} />
          </linearGradient>
          <linearGradient id="offSiteFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.offSite} stopOpacity={0.45} />
            <stop offset="100%" stopColor={COLORS.offSite} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <XAxis dataKey="day" tickFormatter={shortDay} {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={40} />
        <Tooltip
          {...tooltipStyle}
          labelFormatter={shortDay}
          formatter={(v: number, name) => [`${v} h`, name === "onSite" ? "On site" : "Off site"]}
        />
        <Area
          type="monotone"
          dataKey="onSite"
          stackId="1"
          stroke={COLORS.onSite}
          fill="url(#onSiteFill)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="offSite"
          stackId="1"
          stroke={COLORS.offSite}
          fill="url(#offSiteFill)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function HoursBarChart({
  data,
}: {
  data: { name: string; hours: number }[];
}) {
  const height = Math.max(140, data.length * 34 + 20);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <XAxis type="number" {...axisProps} />
        <YAxis
          type="category"
          dataKey="name"
          width={130}
          {...axisProps}
          tick={{ fill: COLORS.axis, fontSize: 11 }}
        />
        <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} h`, "Hours"]} cursor={{ fill: "var(--color-surface-2)" }} />
        <Bar dataKey="hours" fill={COLORS.bar} radius={[0, 4, 4, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ApprovalDonut({
  approved,
  pending,
}: {
  approved: number;
  pending: number;
}) {
  const data = [
    { name: "Approved", value: approved, color: COLORS.approved },
    { name: "Pending", value: pending, color: COLORS.pending },
  ];
  const total = approved + pending;
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={58}
            outerRadius={82}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} formatter={(v: number, n) => [`${v} entries`, n]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums">
          {total ? Math.round((approved / total) * 100) : 0}%
        </span>
        <span className="text-[11px] text-[var(--color-muted)]">approved</span>
      </div>
    </div>
  );
}

export function BudgetBarChart({
  data,
}: {
  data: { name: string; logged: number; budget: number; status: "under" | "near" | "over" | "none" }[];
}) {
  const height = Math.max(140, data.length * 40 + 24);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <XAxis type="number" {...axisProps} unit="h" />
        <YAxis type="category" dataKey="name" width={150} {...axisProps} />
        <Tooltip
          {...tooltipStyle}
          cursor={{ fill: "var(--color-surface-2)" }}
          formatter={(v: number, n) => [`${v} h`, n === "logged" ? "Logged" : "Budget"]}
        />
        <Bar dataKey="budget" fill="var(--color-chip-muted)" radius={[0, 4, 4, 0]} barSize={9} />
        <Bar dataKey="logged" radius={[0, 4, 4, 0]} barSize={9}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.status === "over" ? COLORS.over : d.status === "near" ? COLORS.near : COLORS.good}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
