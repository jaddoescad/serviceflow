// Project-detail summaries are intentionally built around time entries.
// GPS segments remain attached to their parent entry as evidence, but they
// are never counted as additional clock-ins.

export function buildPainterClockInSummaries(days = []) {
  const byPainter = new Map();

  for (const day of days) {
    for (const painter of day.painters || []) {
      const key = painter.name;
      if (!byPainter.has(key)) {
        byPainter.set(key, {
          id: key.toLowerCase().replace(/\s+/g, "-"),
          name: painter.name,
          initials: painter.initials,
          isYou: Boolean(painter.isYou),
          totalMinutes: 0,
          clockInCount: 0,
          onSiteCount: 0,
          offSiteCount: 0,
          mixedCount: 0,
          unknownLocationCount: 0,
          days: [],
        });
      }

      const summary = byPainter.get(key);
      const clockIns = groupSegmentsByClockIn(painter.segments || []);
      summary.days.push({
        dayId: day.id,
        label: day.label,
        dateLabel: day.dateLabel,
        clockIns,
      });

      for (const clockIn of clockIns) {
        summary.totalMinutes += clockIn.durationMinutes;
        summary.clockInCount += 1;
        if (clockIn.status === "on") summary.onSiteCount += 1;
        else if (clockIn.status === "off") summary.offSiteCount += 1;
        else if (clockIn.status === "mixed") summary.mixedCount += 1;
        else summary.unknownLocationCount += 1;
      }
    }
  }

  return Array.from(byPainter.values()).sort((left, right) => {
    if (left.isYou && !right.isYou) return -1;
    if (!left.isYou && right.isYou) return 1;
    return right.totalMinutes - left.totalMinutes;
  });
}

export function groupSegmentsByClockIn(segments = []) {
  const grouped = new Map();

  for (const [index, segment] of segments.entries()) {
    const entryId = getEntryId(segment, index);
    if (!grouped.has(entryId)) grouped.set(entryId, []);
    grouped.get(entryId).push(segment);
  }

  return Array.from(grouped.entries()).map(([entryId, gpsSegments]) => {
    const first = gpsSegments[0];
    const last = gpsSegments[gpsSegments.length - 1];
    const raw = first?.raw || null;
    const breakdown = gpsSegments.reduce(
      (totals, segment) => {
        const durationMs = getSegmentDurationMs(segment);
        if (segment.status === "on") totals.onSiteMs += durationMs;
        else if (segment.status === "off") totals.offSiteMs += durationMs;
        else totals.unknownMs += durationMs;
        return totals;
      },
      { onSiteMs: 0, offSiteMs: 0, unknownMs: 0 },
    );
    const status = getClockInStatus(breakdown, raw, gpsSegments);
    const rawDurationMs = Number(raw?.durationMs);
    const durationMs = Number.isFinite(rawDurationMs)
      ? Math.max(0, rawDurationMs)
      : gpsSegments.reduce((total, segment) => total + getSegmentDurationMs(segment), 0);

    return {
      id: entryId,
      start: first?.entryStart || first?.start || "--",
      startSrc: first?.entryStartSrc || first?.startSrc || "Manual",
      end: last?.entryEnd || last?.end || "--",
      endSrc: last?.entryEndSrc || last?.endSrc || "Manual",
      durationMinutes: Math.floor(durationMs / 60_000),
      duration: formatMinutes(durationMs),
      status,
      distanceLabel: findLatestDistanceLabel(gpsSegments),
      locationBreakdown: breakdown,
      gpsSegments,
      raw,
      isCurrentUser: Boolean(first?.isCurrentUser),
    };
  });
}

function getEntryId(segment, index) {
  const raw = segment?.raw;
  return String(
    segment?.entryId ||
      raw?.serverId ||
      raw?.id ||
      raw?.localId ||
      `clock-in-${index}`,
  );
}

function getSegmentDurationMs(segment) {
  const durationMs = Number(segment?.durationMs);
  if (Number.isFinite(durationMs)) return Math.max(0, durationMs);

  const match = String(segment?.duration || "").match(/(\d+)\s*h\s*(\d+)\s*m/);
  if (!match) return 0;
  return (Number(match[1]) * 60 + Number(match[2])) * 60_000;
}

function getClockInStatus(breakdown, raw, gpsSegments) {
  const hasOnSite = breakdown.onSiteMs > 0;
  const hasOffSite = breakdown.offSiteMs > 0;
  if (hasOnSite && hasOffSite) return "mixed";
  if (hasOnSite) return "on";
  if (hasOffSite) return "off";
  if (raw?.onSite === true) return "on";
  if (raw?.onSite === false) return "off";
  if (gpsSegments.some((segment) => segment.status === "on")) return "on";
  if (gpsSegments.some((segment) => segment.status === "off")) return "off";
  return "unknown";
}

function findLatestDistanceLabel(segments) {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index]?.distanceLabel) return segments[index].distanceLabel;
  }
  return null;
}

function formatMinutes(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}
