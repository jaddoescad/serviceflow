import type { Segment, TimeEntry } from "@/lib/types";

const MS_PER_HOUR = 1000 * 60 * 60;
// A still-"active" entry older than this almost certainly means the painter
// forgot to clock out.
export const STALE_ACTIVE_HOURS = 16;

export type EntryDurations = {
  totalMs: number;
  onSiteMs: number;
  offSiteMs: number;
  totalHours: number;
  latestDistanceMeters: number | null;
};

function normalizeSegments(entry: TimeEntry, now: number): Segment[] {
  const raw = Array.isArray(entry.segments) ? entry.segments : [];
  if (raw.length) {
    return raw.map((segment, index) => ({
      ...segment,
      // Mobile location updates store endedAt as the latest GPS checkpoint.
      // The final segment remains open until the active shift is clocked out.
      endedAt:
        entry.status === "active" && index === raw.length - 1
          ? new Date(now).toISOString()
          : segment.endedAt,
    }));
  }
  // No segment history: treat the whole shift as one on/off-site block.
  return [
    {
      mode: entry.is_on_site === false ? "off_site" : "on_site",
      startedAt: entry.started_at,
      endedAt: entry.ended_at ?? new Date(now).toISOString(),
      distanceMeters: entry.last_distance_meters ?? null,
    },
  ];
}

/**
 * Uses clock-in/clock-out for the authoritative total. Location segments only
 * describe how that time was split between on-site and off-site activity.
 * Active shifts are counted up to `now`.
 */
export function computeDurations(entry: TimeEntry, now = Date.now()): EntryDurations {
  const entryStart = new Date(entry.started_at).getTime();
  const entryEnd =
    entry.status === "active"
      ? now
      : new Date(entry.ended_at ?? new Date(now).toISOString()).getTime();
  const hasValidEntryBounds = Number.isFinite(entryStart) && Number.isFinite(entryEnd);
  const clockDurationMs = hasValidEntryBounds ? Math.max(0, entryEnd - entryStart) : null;
  const result: EntryDurations = {
    // Payroll/job totals must come from the explicit clock-in and clock-out.
    // Location segments are only used to split that total into on/off-site time.
    totalMs: clockDurationMs ?? 0,
    onSiteMs: 0,
    offSiteMs: 0,
    totalHours: 0,
    latestDistanceMeters: entry.last_distance_meters ?? null,
  };

  let lastMode: Segment["mode"] = entry.is_on_site === false ? "off_site" : "on_site";

  for (const segment of normalizeSegments(entry, now)) {
    const start = new Date(segment.startedAt ?? entry.started_at).getTime();
    const end = new Date(segment.endedAt ?? entry.ended_at ?? new Date(now).toISOString()).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const boundedStart = hasValidEntryBounds ? Math.max(start, entryStart) : start;
    const boundedEnd = hasValidEntryBounds ? Math.min(end, entryEnd) : end;
    const durationMs = Math.max(0, boundedEnd - boundedStart);
    lastMode = segment.mode ?? lastMode;
    if (segment.mode === "off_site") result.offSiteMs += durationMs;
    else result.onSiteMs += durationMs;
    if (segment.distanceMeters != null) result.latestDistanceMeters = segment.distanceMeters;
  }

  const segmentedMs = result.onSiteMs + result.offSiteMs;
  if (clockDurationMs == null) {
    result.totalMs = segmentedMs;
  } else if (segmentedMs > clockDurationMs && segmentedMs > 0) {
    // Defensive protection against overlapping/corrupt location segments.
    const scale = clockDurationMs / segmentedMs;
    result.onSiteMs *= scale;
    result.offSiteMs *= scale;
  } else if (segmentedMs < clockDurationMs) {
    // GPS may stop reporting while a shift remains clocked in. Keep the total
    // correct and attribute uncovered time to the most recent known state.
    const uncoveredMs = clockDurationMs - segmentedMs;
    if (lastMode === "off_site") result.offSiteMs += uncoveredMs;
    else result.onSiteMs += uncoveredMs;
  }

  result.totalHours = result.totalMs / MS_PER_HOUR;
  return result;
}

export function entryHours(entry: TimeEntry, now = Date.now()): number {
  return computeDurations(entry, now).totalHours;
}

export function isStaleActive(entry: TimeEntry, now = Date.now()): boolean {
  if (entry.status !== "active") return false;
  const start = new Date(entry.started_at).getTime();
  if (!Number.isFinite(start)) return false;
  return now - start > STALE_ACTIVE_HOURS * MS_PER_HOUR;
}

export function wasEdited(entry: TimeEntry): boolean {
  if (entry.start_edited_at) return true;
  return Array.isArray(entry.adjustment_history) && entry.adjustment_history.length > 0;
}
