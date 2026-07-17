import { Avatar, Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { dayKey, fmtDate, fmtTime, initials } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

const DAYS_TO_SHOW = 7;

type ActivityDay = {
  key: string;
  label: string;
  entries: TimeEntry[];
};

export function ActivityTable({ entries, now }: { entries: TimeEntry[]; now: number }) {
  const days = groupRecentActivity(entries, now);
  const entryCount = days.reduce((total, day) => total + day.entries.length, 0);

  return (
    <Card>
      <CardHeader
        title="Daily activity"
        subtitle="Last 7 activity days · one row per clock-in"
        right={<Badge tone="neutral">{entryCount} entries</Badge>}
      />
      {entryCount === 0 ? (
        <EmptyState>No clock-in activity yet.</EmptyState>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
              <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-4 py-2 font-medium">Crew &amp; job</th>
                <th className="w-24 px-2 py-2 font-medium">In</th>
                <th className="w-24 px-4 py-2 font-medium">Out</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <ActivityDayRows key={day.key} day={day} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ActivityDayRows({ day }: { day: ActivityDay }) {
  return (
    <>
      <tr className="bg-[var(--color-surface-2)]">
        <th
          colSpan={3}
          className="border-y border-[var(--color-border)] px-4 py-1.5 text-left text-xs font-semibold text-[var(--color-heading)]"
        >
          {day.label}
        </th>
      </tr>
      {day.entries.map((entry) => (
        <tr
          key={entry.id}
          className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]"
        >
          <td className="px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar label={initials(entry.user_name)} />
              <div className="min-w-0">
                <div className="truncate font-medium">{entry.user_name ?? "Painter"}</div>
                <div className="truncate text-xs text-[var(--color-muted)]">{entry.project_name}</div>
              </div>
            </div>
          </td>
          <td className="whitespace-nowrap px-2 py-2.5 text-xs tabular-nums">
            {fmtTime(entry.started_at)}
          </td>
          <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums">
            {entry.status === "active" ? <Badge tone="good">active</Badge> : fmtTime(entry.ended_at)}
          </td>
        </tr>
      ))}
    </>
  );
}

function groupRecentActivity(entries: TimeEntry[], now: number): ActivityDay[] {
  const today = dayKey(new Date(now));
  const yesterday = dayKey(new Date(now - 24 * 60 * 60 * 1000));
  const grouped = new Map<string, TimeEntry[]>();

  const sorted = [...entries].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );

  for (const entry of sorted) {
    const key = dayKey(entry.started_at);
    if (!grouped.has(key) && grouped.size >= DAYS_TO_SHOW) continue;
    const dayEntries = grouped.get(key) ?? [];
    dayEntries.push(entry);
    grouped.set(key, dayEntries);
  }

  return [...grouped.entries()].map(([key, dayEntries]) => ({
    key,
    label: key === today ? "Today" : key === yesterday ? "Yesterday" : fmtDate(dayEntries[0]?.started_at ?? null),
    entries: dayEntries,
  }));
}
