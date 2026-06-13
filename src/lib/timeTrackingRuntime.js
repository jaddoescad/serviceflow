import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { updateActiveLocation } from "./timeEntryRepository";
import { appendSegment, createLocationStatus, enrichLocationStatus, toPoint } from "./timeTrackingLocation";
import { notifyIfNeeded, requestNotificationPermissions } from "./timeTrackingNotifications";
import { readStore, writeStore } from "./timeTrackingStorage";

export const BACKGROUND_LOCATION_TASK = "ottawa-painters-background-location";

async function handleBackgroundLocation(location) {
  const point = toPoint(location);
  if (!point) return;

  const store = await readStore();
  const shift = store.activeShift;
  if (!shift) return;

  const status = await enrichLocationStatus(createLocationStatus(shift, store.knownProjects || [], point));
  const nextShift = appendSegment(
    {
      ...shift,
      lastLocation: point,
      lastLocationLabel: status.locationLabel || shift.lastLocationLabel || null,
      lastDistanceMeters: status.activeDistance,
      onSite: status.onSite,
      travelStartedAt: status.onSite === false && !shift.travelStartedAt ? new Date().toISOString() : shift.travelStartedAt,
    },
    status,
  );

  const didNotify = await notifyIfNeeded(store, status, nextShift);
  await writeStore({
    ...store,
    activeShift: nextShift,
    lastNotificationAt: didNotify ? Date.now() : store.lastNotificationAt || 0,
    lastNotice: {
      type: status.suggestedProject ? "switch_project" : status.shouldPromptClockOut ? "clock_out" : "status",
      message: status.label,
      suggestedProject: status.suggestedProject,
      createdAt: new Date().toISOString(),
    },
  });
  await updateActiveLocation(nextShift);
}

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const locations = data?.locations || [];
    const latest = locations[locations.length - 1];
    if (latest) await handleBackgroundLocation(latest);
  });
}

export async function requestTrackingPermissions() {
  const notifications = await requestNotificationPermissions();

  let foreground = { granted: false };
  try {
    foreground = await Location.requestForegroundPermissionsAsync();
  } catch (_error) {
    foreground = { granted: false };
  }

  let background = false;
  if (foreground.granted) {
    try {
      const response = await Location.requestBackgroundPermissionsAsync();
      background = !!response.granted;
    } catch (_error) {
      background = false;
    }
  }

  return { foreground: !!foreground.granted, background, notifications };
}

export async function getCurrentPoint() {
  try {
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return toPoint(location);
  } catch (_error) {
    return null;
  }
}

export async function startBackgroundTracking() {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (started) return true;
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 50,
      timeInterval: 60000,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: "Ottawa Painters clock-in active",
        notificationBody: "Tracking location while you are clocked in.",
      },
    });
    return true;
  } catch (_error) {
    return false;
  }
}

export async function stopBackgroundTracking() {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (started) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch (_error) {
    // Non-fatal.
  }
}

export async function watchActiveLocation(onLocation) {
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 30000 },
    onLocation,
  );
}
