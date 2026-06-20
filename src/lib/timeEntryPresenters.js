import { activeEntry, entryProjectId } from "./timeEntryModel";
import { formatDistance, formatDuration, normalizeProject } from "./trackingModel";

function formatSegmentDistanceLabel(segment, fallbackDistanceMeters = null) {
  const distanceMeters = segment?.distanceMeters ?? fallbackDistanceMeters;
  if (distanceMeters == null || !Number.isFinite(Number(distanceMeters))) return null;
  return `${formatDistance(distanceMeters)} from site`;
}

function getEntrySegments(entry) {
  const segments = Array.isArray(entry?.segments) && entry.segments.length
    ? entry.segments
    : [
        {
          mode: entry?.onSite === false ? "off_site" : "on_site",
          startedAt: entry?.startedAt,
          endedAt: entry?.endedAt,
          distanceMeters: entry?.lastDistanceMeters,
        },
      ];

  return segments.map((segment) => ({
    ...segment,
    mode: segment.mode || (entry?.onSite === false ? "off_site" : "on_site"),
    startedAt: segment.startedAt || entry?.startedAt,
    endedAt: segment.endedAt || entry?.endedAt || new Date().toISOString(),
    distanceMeters: segment.distanceMeters ?? entry?.lastDistanceMeters ?? null,
  }));
}

function getSegmentDurationMs(segment) {
  const start = new Date(segment.startedAt).getTime();
  const end = new Date(segment.endedAt || Date.now()).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

function summarizeSegments(entry) {
  const summary = {
    totalMs: 0,
    onSiteMs: 0,
    offSiteMs: 0,
    latestDistanceMeters: entry?.lastDistanceMeters ?? null,
    status: entry?.onSite === false ? "Off Site" : "On Site",
  };

  for (const segment of getEntrySegments(entry)) {
    const durationMs = getSegmentDurationMs(segment);
    summary.totalMs += durationMs;

    if (segment.mode === "off_site") {
      summary.offSiteMs += durationMs;
      summary.status = "Off Site";
    } else {
      summary.onSiteMs += durationMs;
    }

    if (segment.distanceMeters != null) {
      summary.latestDistanceMeters = segment.distanceMeters;
    }
  }

  if (summary.onSiteMs > 0 && summary.offSiteMs > 0) summary.status = "Mixed";
  if (summary.totalMs === 0) summary.totalMs = entry?.durationMs || 0;
  if (summary.onSiteMs === 0 && summary.offSiteMs === 0) {
    if (entry?.onSite === false) summary.offSiteMs = summary.totalMs;
    else summary.onSiteMs = summary.totalMs;
  }

  return summary;
}

function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function entryIdentityKeys(entry) {
  return [entry?.serverId, entry?.id, entry?.localId]
    .map((value) => String(value || ""))
    .filter(Boolean);
}

function formatDayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString().slice(0, 10);
}

function initials(name) {
  return String(name || "Painter")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "P";
}

export function summarizeAdjustments(entry) {
  const history = Array.isArray(entry?.adjustmentHistory) ? entry.adjustmentHistory : [];
  const last = history[history.length - 1] || null;
  const originStart = entry?.originalStartedAt || history[0]?.previousStartedAt;
  const currentStart = entry?.startedAt || last?.nextStartedAt;
  const netMinutes =
    originStart && currentStart
      ? Math.round((new Date(currentStart).getTime() - new Date(originStart).getTime()) / 60000)
      : 0;

  if (!netMinutes) return null;

  return {
    netMinutes,
    editedAtLabel: formatClock(entry?.startEditedAt || last?.adjustedAt),
    editedBy: last?.adjustedByName || last?.adjustedByEmail || entry?.userName || "Painter",
  };
}

export function getProjectTimeTotals(entries = [], activeShift = null) {
  const active = activeEntry(activeShift);
  const all = active ? [active, ...entries] : entries;
  const totals = {};

  for (const entry of all) {
    const id = entryProjectId(entry);
    if (!id) continue;
    totals[id] = (totals[id] || 0) + (entry.durationMs || 0);
  }

  return Object.fromEntries(Object.entries(totals).map(([id, ms]) => [id, formatDuration(ms)]));
}

export function buildTimesheetDays(entries = [], activeShift = null) {
  const active = activeEntry(activeShift);
  const all = active ? [active, ...entries] : entries;
  const groups = new Map();

  for (const entry of all) {
    const key = formatDayKey(entry.startedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, dayEntries]) => {
      const date = new Date(`${key}T12:00:00`);
      const totalMinutes = Math.floor(dayEntries.reduce((sum, entry) => sum + (entry.durationMs || 0), 0) / 60000);
      const segmentSummary = dayEntries.reduce(
        (summary, entry) => {
          const entrySummary = summarizeSegments(entry);
          return {
            onSiteMs: summary.onSiteMs + entrySummary.onSiteMs,
            offSiteMs: summary.offSiteMs + entrySummary.offSiteMs,
          };
        },
        { onSiteMs: 0, offSiteMs: 0 },
      );
      const onSiteMinutes = Math.floor(segmentSummary.onSiteMs / 60000);
      const driveMinutes = Math.floor(segmentSummary.offSiteMs / 60000);

      return {
        id: key,
        weekday: date.toLocaleDateString([], { weekday: "short" }),
        date: date.toLocaleDateString([], { month: "short", day: "2-digit" }),
        type: "worked",
        total: formatDuration(totalMinutes * 60000),
        totalMinutes,
        onSite: formatDuration(onSiteMinutes * 60000),
        drive: formatDuration(driveMinutes * 60000),
        jobs: Array.from(new Set(dayEntries.map((entry) => entry.project?.name || "Project"))).slice(0, 4),
        entries: dayEntries.map((entry) => {
          const entrySummary = summarizeSegments(entry);
          return {
            id: entry.id || entry.localId,
            job: entry.project?.name || "Project",
            address: entry.project?.formatted_address || entry.project?.address || "No address on file",
            start: formatClock(entry.startedAt),
            startSrc: entry.startedLocation ? "GPS" : "Manual",
            end: entry.clockOutReason === "active" ? "Now" : formatClock(entry.endedAt),
            endSrc: entry.lastLocation ? "GPS" : "Manual",
            duration: formatDuration(entry.durationMs),
            status: entrySummary.status,
            distance:
              entrySummary.latestDistanceMeters == null
                ? "distance unknown"
                : `${formatDistance(entrySummary.latestDistanceMeters)} from site`,
            onSiteDuration: formatDuration(entrySummary.onSiteMs),
            offSiteDuration: formatDuration(entrySummary.offSiteMs),
            raw: entry,
          };
        }),
      };
    });
}

export function buildProjectClockInDays(entries = [], activeShift = null, project, user = null) {
  const projectId = normalizeProject(project)?.companycam_id;
  if (!projectId) return [];
  const currentUserId = user?.id || null;
  const currentUserEmail = user?.email || null;

  const active = activeEntry(activeShift);
  const seenEntries = new Set();
  const all = (active ? [active, ...entries] : entries)
    .filter((entry) => {
      const keys = entryIdentityKeys(entry);
      if (!keys.length) return true;
      if (keys.some((key) => seenEntries.has(key))) return false;
      keys.forEach((key) => seenEntries.add(key));
      return true;
    })
    .filter((entry) => entryProjectId(entry) === projectId);
  const groups = new Map();

  for (const entry of all) {
    const dayKey = formatDayKey(entry.startedAt);
    const userName = entry.userName || "Painter";
    if (!groups.has(dayKey)) groups.set(dayKey, new Map());
    const byPainter = groups.get(dayKey);
    if (!byPainter.has(userName)) {
      byPainter.set(userName, {
        name: userName,
        initials: initials(userName),
        isYou: Boolean(
          (currentUserId && entry.userId === currentUserId) ||
          (currentUserEmail && entry.userEmail === currentUserEmail),
        ),
        segments: [],
      });
    }

    const sourceSegments = getEntrySegments(entry);
    const isCurrentUser = Boolean(
      (currentUserId && entry.userId === currentUserId) ||
      (currentUserEmail && entry.userEmail === currentUserEmail),
    );
    for (const segment of sourceSegments) {
      const start = segment.startedAt || entry.startedAt;
      const end = segment.endedAt || entry.endedAt;
      const durationMs = getSegmentDurationMs({ startedAt: start, endedAt: end });
      byPainter.get(userName).segments.push({
        start: formatClock(start),
        startSrc: entry.startedLocation ? "GPS" : "Manual",
        end: entry.clockOutReason === "active" ? "Now" : formatClock(end),
        endSrc: entry.lastLocation ? "GPS" : "Manual",
        duration: formatDuration(durationMs),
        status: segment.mode === "off_site" ? "off" : "on",
        distanceLabel: formatSegmentDistanceLabel(segment),
        raw: entry,
        isCurrentUser,
      });
    }
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, byPainter], index) => {
      const date = new Date(`${key}T12:00:00`);
      return {
        id: key,
        label: index === 0 ? "Today" : date.toLocaleDateString([], { weekday: "long" }),
        dateLabel: date.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }),
        painters: Array.from(byPainter.values()),
      };
    });
}
