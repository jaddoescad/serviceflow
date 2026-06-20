import { normalizeProject } from "./trackingModel";

export function shiftToEntry(shift, endedAt = new Date().toISOString(), reason = "manual") {
  const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(shift.startedAt).getTime());
  return {
    id: shift.serverId || shift.localId,
    localId: shift.localId,
    serverId: shift.serverId,
    userId: shift.userId,
    userEmail: shift.userEmail,
    userName: shift.userName,
    project: shift.project,
    originalStartedAt: shift.originalStartedAt || shift.startedAt,
    startedAt: shift.startedAt,
    startEditedAt: shift.startEditedAt || null,
    endedAt,
    durationMs,
    clockOutReason: reason,
    startedLocation: shift.startedLocation,
    lastLocation: shift.lastLocation,
    lastLocationLabel: shift.lastLocationLabel,
    lastDistanceMeters: shift.lastDistanceMeters,
    onSite: shift.onSite,
    segments: shift.segments || [],
    adjustmentHistory: shift.adjustmentHistory || [],
  };
}

export function activeEntry(activeShift) {
  return activeShift ? shiftToEntry(activeShift, new Date().toISOString(), "active") : null;
}

export function entryProjectId(entry) {
  return String(entry?.project?.companycam_id || entry?.companycam_project_id || "");
}

export function applyEntryTimeUpdate(entry, updates = {}) {
  const startedAt = updates.startedAt || entry.startedAt;
  const originalStartedAt = entry.originalStartedAt || entry.startedAt;
  const isActive = entry.clockOutReason === "active" || !entry.endedAt;
  const endedAt = updates.endedAt || entry.endedAt || (isActive ? null : new Date().toISOString());
  const project = updates.project ? normalizeProject(updates.project) : entry.project;
  const durationEnd = endedAt || new Date().toISOString();
  const durationMs = Math.max(0, new Date(durationEnd).getTime() - new Date(startedAt).getTime());
  const segments = Array.isArray(entry.segments) && entry.segments.length
    ? entry.segments.map((segment, index, list) => ({
        ...segment,
        startedAt: index === 0 ? startedAt : segment.startedAt,
        endedAt: index === list.length - 1 ? endedAt : segment.endedAt,
      }))
    : entry.segments || [];

  const previousProjectId = entry.project?.companycam_id || entry.project?.id || null;
  const nextProjectId = project?.companycam_id || project?.id || null;
  const startChanged = startedAt !== entry.startedAt;
  const changed =
    startChanged ||
    endedAt !== (entry.endedAt || null) ||
    String(previousProjectId || "") !== String(nextProjectId || "");
  const adjustedAt = new Date().toISOString();
  const adjustedBy = updates.adjustedBy || {};
  const adjustmentHistory = changed && !updates.skipAdjustmentHistory
    ? [
        ...(entry.adjustmentHistory || []),
        {
          adjustedAt,
          adjustedByUserId: adjustedBy.id || entry.userId || null,
          adjustedByEmail: adjustedBy.email || entry.userEmail || null,
          adjustedByName: adjustedBy.name || entry.userName || null,
          source: updates.adjustmentSource || "time_edit",
          previousStartedAt: entry.startedAt || null,
          nextStartedAt: startedAt || null,
          previousEndedAt: entry.endedAt || null,
          nextEndedAt: endedAt || null,
          previousProjectId,
          nextProjectId,
        },
      ]
    : entry.adjustmentHistory || [];

  return {
    ...entry,
    project,
    originalStartedAt,
    startedAt,
    startEditedAt: startChanged ? adjustedAt : entry.startEditedAt || null,
    endedAt,
    durationMs,
    segments,
    adjustmentHistory,
  };
}
