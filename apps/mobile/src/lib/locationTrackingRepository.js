import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { isLocationTrackingEnabledForUser } from "./locationTrackingFeature";
import {
  readLocationQueue,
  readPendingTrackingStatus,
  removeLocationPoints,
  writePendingTrackingStatus,
  enqueueLocationPoints,
  mergeTrackingRuntimeState,
} from "./timeTrackingStorage";
import {
  TRACKING_MODE,
  shouldRecordLocation,
  trackingEventId,
} from "./locationTrackingPolicy";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let syncInFlight = null;

function uuidOrNull(value) {
  return UUID_PATTERN.test(String(value || "")) ? value : null;
}

function pointValue(point, camelKey, snakeKey = camelKey) {
  return point?.[camelKey] ?? point?.[snakeKey] ?? null;
}

export function buildLocationRow(shift, point, options = {}) {
  if (!shift?.userId || !shift?.localId || !point) return null;
  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const eventType = options.eventType || "location";
  return {
    client_event_id: trackingEventId(shift, point, eventType),
    time_entry_id: uuidOrNull(shift.serverId),
    client_entry_id: shift.localId,
    job_id: shift.project?.id || shift.project?.job_id || shift.project?.companycam_id || null,
    latitude,
    longitude,
    accuracy_meters: numericOrNull(pointValue(point, "accuracy", "accuracy_meters")),
    speed_mps: numericOrNull(pointValue(point, "speed", "speed_mps")),
    heading_degrees: numericOrNull(pointValue(point, "heading", "heading_degrees")),
    is_mocked: typeof point.mocked === "boolean" ? point.mocked : null,
    tracking_mode: normalizeLocationMode(options.mode),
    event_type: eventType,
    distance_from_job_meters: integerOrNull(options.status?.activeDistance),
    is_on_site: typeof options.status?.onSite === "boolean" ? options.status.onSite : null,
    captured_at: point.capturedAt || point.captured_at || new Date().toISOString(),
  };
}

export async function queueLocationSample(shift, point, options = {}) {
  if (!isLocationTrackingEnabledForUser(shift)) return null;
  const mode = normalizeLocationMode(options.mode);
  if (
    !shouldRecordLocation(
      options.previousRecordedPoint || null,
      point,
      mode,
      options.eventType || "location",
    )
  ) {
    return null;
  }

  const row = buildLocationRow(shift, point, { ...options, mode });
  if (!row) return null;
  await enqueueLocationPoints(row);
  return row;
}

export async function queueTrackingStatus(shift, options = {}) {
  if (!isLocationTrackingEnabledForUser(shift)) return null;
  if (!shift?.userId) return null;
  const point = options.point || shift.lastLocation || null;
  const permissionFields = {};
  if (typeof options.permissions?.foreground === "boolean") {
    permissionFields.permission_foreground = options.permissions.foreground;
  }
  if (typeof options.permissions?.background === "boolean") {
    permissionFields.permission_background = options.permissions.background;
  }
  const status = {
    time_entry_id: uuidOrNull(shift.serverId),
    client_entry_id: shift.localId || null,
    job_id: shift.project?.id || shift.project?.job_id || shift.project?.companycam_id || null,
    latitude: numericOrNull(point?.latitude),
    longitude: numericOrNull(point?.longitude),
    accuracy_meters: numericOrNull(pointValue(point, "accuracy", "accuracy_meters")),
    last_location_at: point?.capturedAt || point?.captured_at || null,
    last_sync_at: new Date().toISOString(),
    tracking_mode: options.mode || TRACKING_MODE.UNKNOWN,
    task_status: options.taskStatus || "paused",
    ...permissionFields,
    platform: Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web" ? Platform.OS : null,
    app_version: Constants.expoConfig?.version || null,
    last_error_code: options.errorCode || null,
    metadata: {
      on_site: typeof shift.onSite === "boolean" ? shift.onSite : null,
      distance_from_project_meters: integerOrNull(shift.lastDistanceMeters),
      reason: options.reason || null,
    },
  };
  const stored = await writePendingTrackingStatus(status, {
    expectedActiveShift:
      options.mode === TRACKING_MODE.CLOCKED_OUT ? null : shift,
  });
  if (!stored) return null;
  return status;
}

export async function syncPendingLocationData() {
  if (syncInFlight) return syncInFlight;
  syncInFlight = performSync().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function performSync() {
  const [points, status] = await Promise.all([
    readLocationQueue(),
    readPendingTrackingStatus(),
  ]);
  let syncedPointCount = 0;
  let statusSynced = false;

  const pendingPoints = [...points];
  if (!pendingPoints.length && status && Number.isFinite(Number(status.latitude)) && Number.isFinite(Number(status.longitude))) {
    pendingPoints.push({
      client_event_id: `tracking-status-${status.client_entry_id || "none"}-${status.last_location_at || status.last_sync_at}`,
      time_entry_id: status.time_entry_id,
      client_entry_id: status.client_entry_id || "tracking-status",
      job_id: status.job_id,
      latitude: Number(status.latitude),
      longitude: Number(status.longitude),
      accuracy_meters: status.accuracy_meters,
      tracking_mode: status.tracking_mode,
      event_type: "tracking_status",
      captured_at: status.last_location_at || new Date().toISOString(),
    });
  }

  for (let index = 0; index < pendingPoints.length; index += 1) {
    const point = pendingPoints[index];
    const includeStatus = status && index === pendingPoints.length - 1;
    try {
      const { error } = await supabase.rpc("record_location_update", {
        point,
        tracking: includeStatus ? status : null,
      });
      if (error) continue;
      if (points.some((queued) => queued.client_event_id === point.client_event_id)) {
        await removeLocationPoints([point.client_event_id]);
        syncedPointCount += 1;
      }
      if (includeStatus) statusSynced = true;
    } catch (_error) {
      // Offline; durable points and the latest status stay queued.
    }
  }

  if (statusSynced && status) {
    await writePendingTrackingStatus(null, { expectedStatus: status });
    await mergeTrackingRuntimeState({
      lastSyncAt: new Date().toISOString(),
      lastErrorCode: null,
    }, {
      expectedActiveShift: status.tracking_mode === TRACKING_MODE.CLOCKED_OUT ? null : status,
    });
  }

  return { syncedPointCount, statusSynced };
}

export async function fetchTeamTrackingStatuses() {
  const { data, error } = await supabase
    .from("employee_tracking_status")
    .select("*")
    .order("last_location_at", { ascending: false, nullsFirst: false });
  return { statuses: error ? [] : (data || []).map(normalizeTrackingStatus), error };
}

export async function fetchEmployeeLocationRoute(userId, startedAt, endedAt) {
  if (!userId) return { points: [], error: null };
  let query = supabase
    .from("employee_location_points")
    .select("*")
    .eq("employee_id", userId)
    .order("captured_at", { ascending: true })
    .limit(2000);
  if (startedAt) query = query.gte("captured_at", startedAt);
  if (endedAt) query = query.lt("captured_at", endedAt);
  const { data, error } = await query;
  return { points: error ? [] : (data || []).map(normalizeLocationPoint), error };
}

function normalizeTrackingStatus(row) {
  return {
    ...row,
    user_id: row.employee_id,
    user_email: row.employee_email,
    user_name: row.employee_name,
    companycam_project_id: row.job_id,
    project_name: row.job_name,
    project_address: row.job_address,
  };
}

function normalizeLocationPoint(row) {
  return {
    ...row,
    user_id: row.employee_id,
    companycam_project_id: row.job_id,
    distance_from_project_meters: row.distance_from_job_meters,
  };
}

function normalizeLocationMode(mode) {
  return mode === TRACKING_MODE.PAINTING || mode === TRACKING_MODE.STATIONARY || mode === TRACKING_MODE.TRAVEL
    ? mode
    : TRACKING_MODE.UNKNOWN;
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numericOrNull(value);
  return number == null ? null : Math.round(number);
}
