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
    startedAt: shift.startedAt,
    endedAt,
    durationMs,
    clockOutReason: reason,
    startedLocation: shift.startedLocation,
    lastLocation: shift.lastLocation,
    lastLocationLabel: shift.lastLocationLabel,
    lastDistanceMeters: shift.lastDistanceMeters,
    onSite: shift.onSite,
    segments: shift.segments || [],
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

  return {
    ...entry,
    project,
    startedAt,
    endedAt,
    durationMs,
    segments,
  };
}
