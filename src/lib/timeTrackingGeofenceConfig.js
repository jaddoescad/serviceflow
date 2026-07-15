import * as Location from "expo-location";
import { Platform } from "react-native";
import { normalizeProject } from "./trackingModel";
import { trackingRegionsSignature } from "./timeTrackingState";
import {
  mergeTrackingRuntimeState,
  readTrackingRuntimeState,
} from "./timeTrackingStorage";
import {
  ACTIVE_PROJECT_REGION_PREFIX,
  GEOFENCE_TASK,
  JOB_GEOFENCE_RADIUS_METERS,
  MAX_GEOFENCE_REGIONS,
  PROJECT_REGION_PREFIX,
  STATIONARY_GEOFENCE_RADIUS_METERS,
  STATIONARY_REGION_ID,
} from "./timeTrackingConstants";

let geofenceMutation = Promise.resolve();

export function regionProjectId(identifier) {
  const value = String(identifier || "");
  if (value.startsWith(ACTIVE_PROJECT_REGION_PREFIX)) {
    return value.slice(ACTIVE_PROJECT_REGION_PREFIX.length);
  }
  if (value.startsWith(PROJECT_REGION_PREFIX)) {
    return value.slice(PROJECT_REGION_PREFIX.length);
  }
  // Backward compatibility with regions registered by older app builds.
  return value && value !== STATIONARY_REGION_ID ? value : null;
}

export function isActiveProjectRegion(identifier) {
  return String(identifier || "").startsWith(ACTIVE_PROJECT_REGION_PREFIX);
}

export function isStationaryRegion(identifier) {
  return String(identifier || "") === STATIONARY_REGION_ID;
}

export function buildTrackingRegions(projects, activeShift = null, stationaryPoint = null) {
  const regions = [];
  const seenProjects = new Set();
  const activeProject = normalizeProject(activeShift?.project);

  if (stationaryPoint && Number.isFinite(Number(stationaryPoint.latitude)) && Number.isFinite(Number(stationaryPoint.longitude))) {
    regions.push({
      identifier: STATIONARY_REGION_ID,
      latitude: Number(stationaryPoint.latitude),
      longitude: Number(stationaryPoint.longitude),
      radius: STATIONARY_GEOFENCE_RADIUS_METERS,
      notifyOnEnter: false,
      notifyOnExit: true,
    });
  }

  if (activeProject?.companycam_id && activeProject.latitude != null && activeProject.longitude != null) {
    seenProjects.add(String(activeProject.companycam_id));
    regions.push({
      identifier: `${ACTIVE_PROJECT_REGION_PREFIX}${activeProject.companycam_id}`,
      latitude: activeProject.latitude,
      longitude: activeProject.longitude,
      radius: JOB_GEOFENCE_RADIUS_METERS,
      notifyOnEnter: true,
      notifyOnExit: true,
    });
  }

  for (const raw of projects || []) {
    if (regions.length >= MAX_GEOFENCE_REGIONS) break;
    const project = normalizeProject(raw);
    const id = String(project?.companycam_id || "");
    if (!id || seenProjects.has(id) || project.latitude == null || project.longitude == null) continue;
    seenProjects.add(id);
    regions.push({
      identifier: `${PROJECT_REGION_PREFIX}${id}`,
      latitude: project.latitude,
      longitude: project.longitude,
      radius: JOB_GEOFENCE_RADIUS_METERS,
      notifyOnEnter: true,
      notifyOnExit: false,
    });
  }

  return regions.slice(0, MAX_GEOFENCE_REGIONS);
}

export async function syncGeofences(projects, activeShift = null, stationaryPoint = null) {
  if (Platform.OS === "web") return false;
  const regions = buildTrackingRegions(projects, activeShift, stationaryPoint);
  return runGeofenceMutation(async () => {
    if (!regions.length) {
      await stopGeofencesNow();
      return false;
    }
    try {
      const signature = trackingRegionsSignature(regions);
      const [started, runtime] = await Promise.all([
        Location.hasStartedGeofencingAsync(GEOFENCE_TASK),
        readTrackingRuntimeState(),
      ]);
      // Re-registering an unchanged region set while already inside a region
      // can emit another enter event on iOS. Treat identical registrations as
      // a no-op so one enter cannot create an arrival-event feedback loop.
      if (started && runtime.geofenceSignature === signature) return true;
      await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
      await mergeTrackingRuntimeState({ geofenceSignature: signature });
      return true;
    } catch (_error) {
      return false;
    }
  });
}

export async function stopGeofences() {
  if (Platform.OS === "web") return;
  return runGeofenceMutation(stopGeofencesNow);
}

function runGeofenceMutation(work) {
  const next = geofenceMutation.catch(() => {}).then(work);
  geofenceMutation = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function stopGeofencesNow() {
  try {
    const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
    if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK);
    await mergeTrackingRuntimeState({ geofenceSignature: null });
  } catch (_error) {
    // Non-fatal.
  }
}
