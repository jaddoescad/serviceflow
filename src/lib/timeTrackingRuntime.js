import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import {
  queueLocationSample,
  queueTrackingStatus,
  syncPendingLocationData,
} from "./locationTrackingRepository";
import {
  TRACKING_MODE,
  modeForLocationStatus,
  updateStationaryState,
} from "./locationTrackingPolicy";
import { updateActiveLocation } from "./timeEntryRepository";
import { appendSegment, createLocationStatus, toPoint } from "./timeTrackingLocation";
import { normalizeProject } from "./trackingModel";
import { notifyIfNeeded, requestNotificationPermissions } from "./timeTrackingNotifications";
import { BACKGROUND_LOCATION_TASK } from "./timeTrackingConstants";
import {
  isStoredShiftActive,
  mergeTrackingRuntimeState,
  readStore,
  readTrackingRuntimeState,
  updateStoredActiveShift,
} from "./timeTrackingStorage";

export { BACKGROUND_LOCATION_TASK };

const TRACKING_CONFIG_VERSION = 4;
const ACTIVE_SHIFT_TRACKING_PROFILE = "active_shift";
const CURRENT_LOCATION_TIMEOUT_MS = 12 * 1000;
const ACTIVE_SHIFT_UPDATE_INTERVAL_MS = 2 * 60 * 1000;
let backgroundLocationMutation = Promise.resolve();
let continuousTrackingMutation = Promise.resolve();

function normalizePermission(response) {
  return {
    granted: !!response?.granted,
    canAskAgain: response?.canAskAgain !== false,
    status: response?.status || (response?.granted ? "granted" : "undetermined"),
  };
}

function buildTrackingPermissions(foreground, notifications = null) {
  const foregroundPermission = normalizePermission(foreground);

  return {
    foreground: foregroundPermission.granted,
    // Kept in the status payload for compatibility with existing rows. The app
    // no longer declares or requests elevated background authorization.
    background: false,
    ready: foregroundPermission.granted,
    foregroundStatus: foregroundPermission.status,
    canAskForegroundAgain: foregroundPermission.canAskAgain,
    access: foregroundPermission.granted ? "while_in_use" : "none",
    notifications,
  };
}

export async function requestTrackingPermissions() {
  const notifications = await requestNotificationPermissions();
  let foreground = { granted: false };
  try {
    foreground = await Location.requestForegroundPermissionsAsync();
  } catch (_error) {
    foreground = { granted: false };
  }

  return buildTrackingPermissions(foreground, notifications);
}

export async function getTrackingPermissions() {
  let foreground = { granted: false };
  try {
    foreground = await Location.getForegroundPermissionsAsync();
  } catch (_error) {
    foreground = { granted: false };
  }

  return buildTrackingPermissions(foreground);
}

export async function getCurrentPoint(options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || CURRENT_LOCATION_TIMEOUT_MS);
  let timeout;
  try {
    const location = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    return toPoint(location);
  } catch (_error) {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function watchActiveLocation(onPoint, onError) {
  if (Platform.OS === "web") return { remove() {} };
  return Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 25,
      timeInterval: 30 * 1000,
    },
    (location) => {
      const point = toPoint(location);
      if (point) onPoint(point);
    },
    onError,
  );
}

function activeShiftTrackingOptions() {
  return {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 50,
    timeInterval: ACTIVE_SHIFT_UPDATE_INTERVAL_MS,
    deferredUpdatesDistance: 100,
    deferredUpdatesInterval: ACTIVE_SHIFT_UPDATE_INTERVAL_MS,
    deferredUpdatesTimeout: 3 * 60 * 1000,
    activityType: Location.ActivityType.Other,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: "ServiceFlow clock-in active",
      notificationBody: "Recording work location for your active shift.",
      killServiceOnDestroy: false,
    },
  };
}

async function startContinuousTracking(mode, expectedShift = null) {
  // Browser location is owned by the foreground watcher in timeTracking.js.
  if (Platform.OS === "web") return true;
  return runContinuousTrackingMutation(async () => {
    const errorCode = "active_shift_tracking_start_failed";
    try {
      if (expectedShift && !(await isStoredShiftActive(expectedShift))) return false;
      const runtime = await readTrackingRuntimeState();
      const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (
        started &&
        runtime.configVersion === TRACKING_CONFIG_VERSION &&
        runtime.trackingProfile === ACTIVE_SHIFT_TRACKING_PROFILE
      ) {
        await mergeTrackingRuntimeState(
          { mode, taskStatus: "running", lastErrorCode: null },
          { expectedActiveShift: expectedShift },
        );
        return true;
      }
      if (started) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (expectedShift && !(await isStoredShiftActive(expectedShift))) return false;

      await Location.startLocationUpdatesAsync(
        BACKGROUND_LOCATION_TASK,
        activeShiftTrackingOptions(),
      );
      await mergeTrackingRuntimeState(
        {
          mode,
          taskStatus: "running",
          configVersion: TRACKING_CONFIG_VERSION,
          trackingProfile: ACTIVE_SHIFT_TRACKING_PROFILE,
          lastErrorCode: null,
        },
        { expectedActiveShift: expectedShift },
      );
      return true;
    } catch (_error) {
      await mergeTrackingRuntimeState(
        {
          mode: TRACKING_MODE.UNAVAILABLE,
          taskStatus: "error",
          trackingProfile: ACTIVE_SHIFT_TRACKING_PROFILE,
          lastErrorCode: errorCode,
        },
        { expectedActiveShift: expectedShift },
      );
      return false;
    }
  });
}

export function startTravelTracking(expectedShift = null) {
  return startContinuousTracking(TRACKING_MODE.TRAVEL, expectedShift);
}

export function startLowPowerTracking(mode, expectedShift = null) {
  const lowPowerMode = mode === TRACKING_MODE.STATIONARY
    ? TRACKING_MODE.STATIONARY
    : TRACKING_MODE.PAINTING;
  return startContinuousTracking(lowPowerMode, expectedShift);
}

async function stopContinuousTracking(taskStatus = "stopped", expectedShift = null) {
  return runContinuousTrackingMutation(async () => {
    if (expectedShift && !(await isStoredShiftActive(expectedShift))) return false;
    if (Platform.OS !== "web") {
      try {
        const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        if (started) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      } catch (_error) {
        // Non-fatal; status below still explains the desired state.
      }
    }
    await mergeTrackingRuntimeState(
      { taskStatus, trackingProfile: null },
      { expectedActiveShift: expectedShift },
    );
    return true;
  });
}

function runContinuousTrackingMutation(work) {
  const next = continuousTrackingMutation.catch(() => {}).then(work);
  continuousTrackingMutation = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function stopBackgroundTracking() {
  await stopContinuousTracking("stopped");
}

// Kept as a compatibility alias for code paths from older local state.
export const startBackgroundTracking = startTravelTracking;

export async function reportTrackingIssue(shift, errorCode, permissions = null) {
  if (!shift || !(await isStoredShiftActive(shift))) return false;
  const runtime = await readTrackingRuntimeState();
  const mode = runtime.mode && runtime.mode !== TRACKING_MODE.CLOCKED_OUT
    ? runtime.mode
    : TRACKING_MODE.UNAVAILABLE;
  const taskStatus = runtime.taskStatus || "error";
  await mergeTrackingRuntimeState(
    { lastErrorCode: errorCode },
    { expectedActiveShift: shift },
  );
  await queueTrackingStatus(shift, {
    mode,
    taskStatus,
    permissions: permissions || runtime.permissions,
    errorCode,
    reason: errorCode,
  });
  await syncPendingLocationData();
  return true;
}

export async function configureAdaptiveTracking(shift, projects, options = {}) {
  if (!shift) {
    await stopContinuousTracking("stopped");
    return { mode: TRACKING_MODE.CLOCKED_OUT, started: false };
  }
  if (!(await isStoredShiftActive(shift))) {
    return { mode: TRACKING_MODE.CLOCKED_OUT, started: false, stale: true };
  }

  const runtime = await readTrackingRuntimeState();
  const knownPermissions = options.permissions || runtime.permissions;
  let mode = options.mode;
  if (!mode) {
    if (runtime.clientEntryId === shift.localId && runtime.mode === TRACKING_MODE.STATIONARY) {
      mode = TRACKING_MODE.STATIONARY;
    } else if (shift.onSite === true) {
      mode = TRACKING_MODE.PAINTING;
    } else {
      mode = TRACKING_MODE.TRAVEL;
    }
  }
  if (mode === TRACKING_MODE.UNKNOWN || mode === TRACKING_MODE.UNAVAILABLE) {
    mode = TRACKING_MODE.TRAVEL;
  }

  const stationaryPoint = mode === TRACKING_MODE.STATIONARY
    ? options.stationaryPoint || shift.lastLocation
    : null;
  if (!(await isStoredShiftActive(shift))) {
    return { mode: TRACKING_MODE.CLOCKED_OUT, started: false, stale: true };
  }
  const requestedMode = mode;
  const expectedErrorCode = "active_shift_tracking_start_failed";
  const started = await startContinuousTracking(requestedMode, shift);
  const taskStatus = started ? "running" : "error";
  if (!started) mode = TRACKING_MODE.UNAVAILABLE;

  if (!(await isStoredShiftActive(shift))) {
    return { mode: TRACKING_MODE.CLOCKED_OUT, started: false, stale: true };
  }

  await mergeTrackingRuntimeState(
    {
      clientEntryId: shift.localId,
      mode,
      taskStatus,
      stationaryPoint,
      permissions: knownPermissions,
      lastErrorCode: started ? null : expectedErrorCode,
    },
    { expectedActiveShift: shift },
  );
  await queueTrackingStatus(shift, {
    mode,
    taskStatus,
    permissions: knownPermissions,
    errorCode: started ? null : expectedErrorCode,
  });
  await syncPendingLocationData();
  return { mode, started };
}

export async function recordShiftLocation(shift, projects, point, options = {}) {
  if (!shift || !point) return { shift, status: null, mode: TRACKING_MODE.UNKNOWN };
  if (!(await isStoredShiftActive(shift))) {
    return { shift, status: null, mode: TRACKING_MODE.CLOCKED_OUT, stale: true };
  }
  const locatedShift = resolveShiftProjectCoordinates(shift, projects || []);
  const rawStatus = createLocationStatus(locatedShift, projects || [], point);
  const accuracy = Number(point.accuracy);
  const reliable = !Number.isFinite(accuracy) || accuracy <= 250;
  const status = reliable
    ? rawStatus
    : {
        ...rawStatus,
        onSite: null,
        suggestedProject: null,
        label: "Location accuracy is still improving.",
      };
  const mode = options.mode || (reliable ? modeForLocationStatus(status) : TRACKING_MODE.TRAVEL);
  const nextShift = appendSegment(
    {
      ...shift,
      ...locatedShift,
      startedLocation: shift.startedLocation || point,
      lastLocation: point,
      lastDistanceMeters: status.activeDistance,
      onSite: status.onSite,
      travelStartedAt:
        mode === TRACKING_MODE.TRAVEL && !shift.travelStartedAt
          ? new Date().toISOString()
          : shift.travelStartedAt,
    },
    status,
  );

  const runtime = await readTrackingRuntimeState();
  const row = await queueLocationSample(nextShift, point, {
    mode,
    eventType: options.eventType || "location",
    status,
    previousRecordedPoint: runtime.lastRecordedPoint || null,
  });
  if (!(await isStoredShiftActive(nextShift))) {
    return { shift: nextShift, status, mode: TRACKING_MODE.CLOCKED_OUT, stale: true };
  }
  await updateActiveLocation(nextShift);
  const tracking = options.skipTrackingReconfigure
    ? { mode, started: true, stale: false }
    : await configureAdaptiveTracking(nextShift, projects, {
        mode,
        permissions: options.permissions,
        stationaryPoint: mode === TRACKING_MODE.STATIONARY ? point : null,
      });
  if (!tracking.stale) {
    await mergeTrackingRuntimeState(
      {
        lastLocationAt: point.capturedAt,
        lastRecordedPoint: row ? point : runtime.lastRecordedPoint || null,
      },
      { expectedActiveShift: nextShift },
    );
  }
  return { shift: nextShift, status, mode, stale: Boolean(tracking.stale) };
}

function resolveShiftProjectCoordinates(shift, projects) {
  const currentProject = normalizeProject(shift?.project);
  if (!currentProject) return shift;
  if (currentProject.latitude != null && currentProject.longitude != null) {
    return currentProject === shift.project ? shift : { ...shift, project: currentProject };
  }

  const replacement = (projects || [])
    .map(normalizeProject)
    .find(
      (project) =>
        project?.companycam_id === currentProject.companycam_id &&
        project.latitude != null &&
        project.longitude != null,
    );
  if (!replacement) return { ...shift, project: currentProject };
  return {
    ...shift,
    project: { ...currentProject, ...replacement },
  };
}

export async function finishTrackingSession(shift, projects, options = {}) {
  // The clock-out caller records a fresh point before closing the local shift.
  // Never manufacture a clock-out event by re-timestamping an older location.
  if (shift?.userId) {
    await queueTrackingStatus(shift, {
      mode: TRACKING_MODE.CLOCKED_OUT,
      taskStatus: "stopped",
      permissions: options.permissions,
      reason: options.reason || "clock_out",
    });
  }
  await stopContinuousTracking("stopped");
  await mergeTrackingRuntimeState({
    clientEntryId: null,
    mode: TRACKING_MODE.CLOCKED_OUT,
    taskStatus: "stopped",
    stationaryPoint: null,
    stationaryState: null,
    trackingProfile: null,
  });
  await syncPendingLocationData();
}

async function handleBackgroundLocations(locations) {
  if (!locations?.length) return;
  const store = await readStore();
  const initialShift = store.activeShift;
  let shift = initialShift;
  if (!shift) return;

  let runtime = await readTrackingRuntimeState();
  let latestStatus = null;
  let latestMode = runtime.mode || TRACKING_MODE.TRAVEL;
  let stationaryState = runtime.stationaryState || null;
  let lastRecordedPoint = runtime.lastRecordedPoint || null;

  for (const location of locations) {
    const point = toPoint(location);
    if (!point) continue;
    const accuracy = Number(point.accuracy);
    if (Number.isFinite(accuracy) && accuracy > 250) continue;
    const status = createLocationStatus(shift, store.knownProjects || [], point);
    let mode = modeForLocationStatus(status);
    stationaryState = updateStationaryState(stationaryState, point, mode);
    if (mode === TRACKING_MODE.TRAVEL && stationaryState.stationary) {
      mode = TRACKING_MODE.STATIONARY;
    }

    shift = appendSegment(
      {
        ...shift,
        lastLocation: point,
        lastDistanceMeters: status.activeDistance,
        onSite: status.onSite,
        travelStartedAt:
          mode === TRACKING_MODE.TRAVEL && !shift.travelStartedAt
            ? new Date().toISOString()
            : shift.travelStartedAt,
      },
      status,
    );

    const row = await queueLocationSample(shift, point, {
      mode,
      status,
      previousRecordedPoint: lastRecordedPoint,
    });
    if (row) lastRecordedPoint = point;
    latestStatus = status;
    latestMode = mode;
  }

  if (!latestStatus) return;
  if (!(await isStoredShiftActive(initialShift))) return;
  const didNotify = await notifyIfNeeded(store, latestStatus, shift);
  const transition = await updateStoredActiveShift(initialShift, shift, {
    lastNotificationAt: didNotify ? Date.now() : store.lastNotificationAt || 0,
    lastNotice: {
      type: latestStatus.suggestedProject
        ? "switch_project"
        : latestStatus.shouldPromptClockOut
          ? "clock_out"
          : "status",
      message: latestStatus.label,
      suggestedProject: latestStatus.suggestedProject,
      createdAt: new Date().toISOString(),
    },
  });
  if (!transition.applied) return;
  await updateActiveLocation(shift);
  // Keep one user-started native tracking service for the entire shift. Mode
  // changes update metadata only, avoiding a prohibited service restart after
  // the app has moved to the background.
  const trackingStarted = await startContinuousTracking(latestMode, shift);
  const taskStatus = trackingStarted ? "running" : "error";
  const statusMode = trackingStarted ? latestMode : TRACKING_MODE.UNAVAILABLE;
  await queueTrackingStatus(shift, {
    mode: statusMode,
    taskStatus,
    permissions: runtime.permissions,
    errorCode: trackingStarted ? null : "active_shift_tracking_start_failed",
  });
  await mergeTrackingRuntimeState(
    {
      clientEntryId: shift.localId,
      mode: statusMode,
      taskStatus,
      stationaryState,
      stationaryPoint:
        latestMode === TRACKING_MODE.STATIONARY ? shift.lastLocation : null,
      lastLocationAt: shift.lastLocation?.capturedAt || null,
      lastRecordedPoint,
      lastErrorCode: trackingStarted ? null : "active_shift_tracking_start_failed",
    },
    { expectedActiveShift: shift },
  );
  await syncPendingLocationData();
}

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      const store = await readStore();
      if (store.activeShift) {
        await reportTrackingIssue(store.activeShift, "background_task_error");
      } else {
        await mergeTrackingRuntimeState({ taskStatus: "error", lastErrorCode: "background_task_error" });
      }
      return;
    }
    const next = backgroundLocationMutation
      .catch(() => {})
      .then(() => handleBackgroundLocations(data?.locations || []));
    backgroundLocationMutation = next.then(
      () => undefined,
      () => undefined,
    );
    await next;
  });
}
