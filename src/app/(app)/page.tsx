import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { OverviewMap } from "@/components/overview-map";
import { PageHeader, Kpi } from "@/components/kpi";
import { Card, CardHeader, Badge, EmptyState } from "@/components/ui";
import { HoursByDayChart, HoursBarChart } from "@/components/charts";
import { ShiftBoard } from "@/components/shift-board";
import { ActivityTable } from "@/components/activity-table";
import { fmtHoursDecimal, fmtDistance, fmtDateTime } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

export const dynamic = "force-dynamic";


export default async function OverviewPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_overview_summary");
  if (error) throw new Error(`overview: ${error.message}`);
  const summary = data as { calculatedAt: string; hoursThisWeek: number; hoursLastWeek: number; activeCount: number; employeeCount: number; activeEmployees: number; onSitePct: number; dayData: { day: string; onSite: number; offSite: number; total: number }[]; topEmployees: { name: string; hours: number }[]; topProjects: { name: string; hours: number }[]; activeEntries: TimeEntry[]; activityEntries: TimeEntry[]; offsiteEntries: TimeEntry[] };
  const now = Date.parse(summary.calculatedAt);
  const { hoursThisWeek, hoursLastWeek, onSitePct, dayData, topEmployees, topProjects } = summary;
  const weekDelta = hoursLastWeek > 0 ? Math.round(((hoursThisWeek - hoursLastWeek) / hoursLastWeek) * 100) : null;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Last 30 days · Ottawa time"
        actions={<Badge tone="brand">{summary.activeCount} on the clock</Badge>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
        <Kpi label="Clocked in now" value={summary.activeCount} hint="live" tone={summary.activeCount ? "good" : "neutral"} />
        <Kpi
          label="Hours this week"
          value={fmtHoursDecimal(hoursThisWeek)}
          delta={weekDelta != null ? { value: weekDelta } : null}
          hint="vs last week"
        />
        <Kpi label="Active crew" value={summary.activeEmployees} hint={`${summary.employeeCount} total`} />
        <Kpi
          label="On-site rate"
          value={`${onSitePct}%`}
          hint="of tracked hours"
          tone={onSitePct >= 90 ? "good" : onSitePct >= 75 ? "warn" : "bad"}
        />
      </div>

      <div className="mt-4">
        <Suspense fallback={<div className="h-[420px]" role="status" aria-label="Loading crew map" />}><OverviewMap now={now} /></Suspense>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader title="Hours per day" subtitle="On site vs off site · last 14 days" />
          <div className="p-4">
            <HoursByDayChart data={dayData} />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Hours by crew member" subtitle="Top 8 · 30 days" />
          <div className="p-4">
            {topEmployees.length ? <HoursBarChart data={topEmployees} /> : <EmptyState>No hours logged yet.</EmptyState>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Hours by job" subtitle="Top 8 · 30 days" />
          <div className="p-4">
            {topProjects.length ? <HoursBarChart data={topProjects} /> : <EmptyState>No hours logged yet.</EmptyState>}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ShiftBoard entries={summary.activeEntries} now={now} />
        <ActivityTable entries={summary.activityEntries} now={now} />
        <AttentionCard
          title="Off-site clock-ins"
          tone="warn"
          empty="No off-site clock-ins."
          items={summary.offsiteEntries.map((e) => ({
            key: e.id,
            primary: e.user_name ?? "Painter",
            secondary: `${e.project_name} · ${fmtDateTime(e.started_at)}`,
            badge: fmtDistance(e.last_distance_meters),
            badgeTone: "warn" as const,
          }))}
        />
      </div>
    </>
  );
}

function AttentionCard({
  title,
  empty,
  items,
}: {
  title: string;
  tone: "warn" | "bad";
  empty: string;
  items: {
    key: string;
    primary: string;
    secondary: string;
    badge: string;
    badgeTone: "warn" | "bad";
  }[];
}) {
  return (
    <Card>
      <CardHeader title={title} right={<Badge tone="neutral">{items.length}</Badge>} />
      {items.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {items.map((it) => (
            <li key={it.key} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{it.primary}</div>
                <div className="truncate text-xs text-[var(--color-muted)]">{it.secondary}</div>
              </div>
              <Badge tone={it.badgeTone}>{it.badge}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
