import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { normalizeProject } from "./trackingModel";
import { notifyArrival } from "./timeTrackingNotifications";
import { handleGeofenceTransition } from "./timeTrackingRuntime";
import { readArrivalPrompts, readStore, writeArrivalPrompts } from "./timeTrackingStorage";
import { GEOFENCE_TASK } from "./timeTrackingConstants";
import {
  regionProjectId,
  syncGeofences,
  stopGeofences,
} from "./timeTrackingGeofenceConfig";

export { GEOFENCE_TASK, syncGeofences, stopGeofences };

const ARRIVAL_COOLDOWN_MS = 30 * 60 * 1000;
let geofenceEventMutation = Promise.resolve();

async function handleClockedOutArrival(region, store) {
  const projectId = regionProjectId(region?.identifier);
  if (!projectId) return;
  const project = (store.knownProjects || [])
    .map(normalizeProject)
    .find((item) => item && String(item.companycam_id) === String(projectId));
  if (!project) return;

  const prompts = await readArrivalPrompts();
  const lastPromptedAt = Number(prompts[projectId] || 0);
  if (Date.now() - lastPromptedAt < ARRIVAL_COOLDOWN_MS) return;

  const notified = await notifyArrival(project);
  if (notified) {
    await writeArrivalPrompts({ ...prompts, [projectId]: Date.now() });
  }
}

async function processGeofenceEvent(data) {
  const eventType = data.eventType;
  const isEnter = eventType === Location.GeofencingEventType.Enter;
  const isExit = eventType === Location.GeofencingEventType.Exit;
  if (!isEnter && !isExit) return;

  const store = await readStore();
  if (store.activeShift) {
    await handleGeofenceTransition({
      eventType: isEnter ? "enter" : "exit",
      region: data.region,
      store,
    });
    return;
  }

  if (isEnter) await handleClockedOutArrival(data.region, store);
}

if (!TaskManager.isTaskDefined(GEOFENCE_TASK)) {
  TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
    if (error || !data?.region) return;
    // iOS may deliver multiple region callbacks together. Serialize them so
    // they cannot all read the same active snapshot and race each other.
    const next = geofenceEventMutation
      .catch(() => {})
      .then(() => processGeofenceEvent(data));
    geofenceEventMutation = next.then(
      () => undefined,
      () => undefined,
    );
    await next;
  });
}
