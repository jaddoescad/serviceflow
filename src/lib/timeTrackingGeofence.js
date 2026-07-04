import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { normalizeProject } from "./trackingModel";
import { notifyArrival } from "./timeTrackingNotifications";
import { readArrivalPrompts, readStore, writeArrivalPrompts } from "./timeTrackingStorage";

export const GEOFENCE_TASK = "ottawa-painters-geofence";

// iOS monitors at most 20 regions per app, so we cap the registered set.
const MAX_REGIONS = 20;
// Slightly wider than the on-site radius (150 m) so arrival fires reliably
// despite GPS jitter around a job site.
const GEOFENCE_RADIUS_METERS = 160;
// Do not re-prompt for the same job more than once within this window.
const ARRIVAL_COOLDOWN_MS = 30 * 60 * 1000;

function projectRegions(projects) {
  const regions = [];
  const seen = new Set();

  for (const raw of projects || []) {
    const project = normalizeProject(raw);
    if (!project || project.latitude == null || project.longitude == null) continue;
    if (seen.has(project.companycam_id)) continue;
    seen.add(project.companycam_id);
    regions.push({
      identifier: String(project.companycam_id),
      latitude: project.latitude,
      longitude: project.longitude,
      radius: GEOFENCE_RADIUS_METERS,
      notifyOnEnter: true,
      notifyOnExit: false,
    });
    if (regions.length >= MAX_REGIONS) break;
  }

  return regions;
}

async function handleGeofenceEnter(region) {
  if (!region?.identifier) return;

  const store = await readStore();
  // Already clocked in: the active-shift tracker owns on-site / switch prompts,
  // so an arrival nudge would be redundant.
  if (store.activeShift) return;

  const project = (store.knownProjects || [])
    .map(normalizeProject)
    .find((item) => item && String(item.companycam_id) === String(region.identifier));
  if (!project) return;

  const prompts = await readArrivalPrompts();
  const lastPromptedAt = Number(prompts[region.identifier] || 0);
  if (Date.now() - lastPromptedAt < ARRIVAL_COOLDOWN_MS) return;

  const notified = await notifyArrival(project);
  if (notified) {
    await writeArrivalPrompts({ ...prompts, [region.identifier]: Date.now() });
  }
}

if (!TaskManager.isTaskDefined(GEOFENCE_TASK)) {
  TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
    if (error) return;
    if (data?.eventType !== Location.GeofencingEventType.Enter) return;
    await handleGeofenceEnter(data.region);
  });
}

// Register (or refresh) the job-site geofences. Requires "Always" background
// location permission; no-ops safely when it is unavailable (e.g. Expo Go).
export async function syncGeofences(projects) {
  if (Platform.OS === "web") return false;

  const regions = projectRegions(projects);
  try {
    if (!regions.length) {
      await stopGeofences();
      return false;
    }
    // startGeofencingAsync replaces any regions previously registered for the
    // task, so re-calling it simply refreshes the monitored set.
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    return true;
  } catch (_error) {
    return false;
  }
}

export async function stopGeofences() {
  if (Platform.OS === "web") return;
  try {
    const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
    if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK);
  } catch (_error) {
    // Non-fatal.
  }
}
