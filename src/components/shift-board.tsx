"use client";

import { useEffect, useState } from "react";
import { Avatar, Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { computeDurations } from "@/lib/hours";
import { fmtHours, fmtTime, initials, fmtDistance } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

export function ShiftBoard({ entries, now }: { entries: TimeEntry[]; now: number }) {
  const [liveNow, setLiveNow] = useState(now);
  const active = entries
    .filter((e) => e.status === "active")
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());

  useEffect(() => {
    if (!active.length) return undefined;
    const interval = window.setInterval(() => setLiveNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, [active.length]);

  return (
    <Card>
      <CardHeader
        title="On the clock now"
        subtitle="Live shifts"
        right={<Badge tone={active.length ? "good" : "neutral"}>{active.length} active</Badge>}
      />
      {active.length === 0 ? (
        <EmptyState>No one is clocked in right now.</EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {active.map((e) => {
            const dur = computeDurations(e, liveNow);
            const offSite = (e.last_distance_meters ?? 0) > 250;
            return (
              <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar label={initials(e.user_name)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.user_name ?? "Painter"}</div>
                  <div className="truncate text-xs text-[var(--color-muted)]">{e.project_name}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium tabular-nums">{fmtHours(dur.totalHours)}</div>
                  <div className="text-xs text-[var(--color-muted)]">since {fmtTime(e.started_at)}</div>
                </div>
                <Badge tone={offSite ? "warn" : "good"}>
                  {offSite ? `off site · ${fmtDistance(e.last_distance_meters)}` : "on site"}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
