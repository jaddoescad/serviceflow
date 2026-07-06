import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { formatDistance, normalizeProject } from "./trackingModel";
import {
  readLastHandledNotificationId,
  writeLastHandledNotificationId,
} from "./timeTrackingStorage";

const CLOCK_OUT_NOTIFICATION_CATEGORY = "ottawa-painters-clock-out-prompt";
const SWITCH_PROJECT_NOTIFICATION_CATEGORY = "ottawa-painters-switch-project-prompt";
const ARRIVAL_NOTIFICATION_CATEGORY = "ottawa-painters-arrival-prompt";
const CLOCK_OUT_NOTIFICATION_ACTION = "clock_out";
const SWITCH_PROJECT_NOTIFICATION_ACTION = "switch_project";
const CLOCK_IN_NOTIFICATION_ACTION = "clock_in";
const NOTIFICATION_COOLDOWN_MS = 10 * 60 * 1000;

export async function notifyIfNeeded(store, status, shift) {
  if (Platform.OS === "web") return false;
  if (!status.shouldPromptClockOut && !status.suggestedProject) return false;
  const now = Date.now();
  if (now - Number(store.lastNotificationAt || 0) < NOTIFICATION_COOLDOWN_MS) return false;

  const title = status.suggestedProject ? "Are you at another job?" : "Still on this job?";
  const body = status.suggestedProject
    ? `You look close to ${status.suggestedProject.name}. Switch your clock-in if this is the new job.`
    : `You are ${formatDistance(status.activeDistance)} from ${shift.project?.name || "the job"}. Clock out if you are done.`;
  const suggestedProject = status.suggestedProject ? normalizeProject(status.suggestedProject) : null;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        categoryIdentifier: suggestedProject ? SWITCH_PROJECT_NOTIFICATION_CATEGORY : CLOCK_OUT_NOTIFICATION_CATEGORY,
        data: {
          type: suggestedProject ? "switch_project" : "clock_out",
          activeProjectId: shift.project?.companycam_id || null,
          suggestedProject,
        },
      },
      trigger: null,
    });
    return true;
  } catch (_error) {
    return false;
  }
}

// Sent from the background geofence task when the painter arrives at a job
// site while clocked out. De-duplication / cooldown is handled by the caller.
export async function notifyArrival(project) {
  if (Platform.OS === "web") return false;
  const normalized = normalizeProject(project);
  if (!normalized) return false;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "You're at a job site",
        body: `Looks like you're at ${normalized.name || "a job"}. Clock in to start tracking your time.`,
        sound: true,
        categoryIdentifier: ARRIVAL_NOTIFICATION_CATEGORY,
        data: {
          type: "arrival",
          project: normalized,
          activeProjectId: normalized.companycam_id || null,
        },
      },
      trigger: null,
    });
    return true;
  } catch (_error) {
    return false;
  }
}

async function configureNotificationActions() {
  if (Platform.OS === "web") return;

  try {
    await Notifications.setNotificationCategoryAsync(ARRIVAL_NOTIFICATION_CATEGORY, [
      {
        identifier: CLOCK_IN_NOTIFICATION_ACTION,
        buttonTitle: "Clock In",
        options: { opensAppToForeground: true },
      },
    ]);

    await Notifications.setNotificationCategoryAsync(CLOCK_OUT_NOTIFICATION_CATEGORY, [
      {
        identifier: CLOCK_OUT_NOTIFICATION_ACTION,
        buttonTitle: "Clock Out",
        options: { opensAppToForeground: true },
      },
    ]);

    await Notifications.setNotificationCategoryAsync(SWITCH_PROJECT_NOTIFICATION_CATEGORY, [
      {
        identifier: SWITCH_PROJECT_NOTIFICATION_ACTION,
        buttonTitle: "Switch Job",
        options: { opensAppToForeground: true },
      },
      {
        identifier: CLOCK_OUT_NOTIFICATION_ACTION,
        buttonTitle: "Clock Out",
        options: { opensAppToForeground: true },
      },
    ]);
  } catch (_error) {
    // Plain notifications still work if action categories are unavailable.
  }
}

export async function requestNotificationPermissions() {
  if (Platform.OS === "web") return false;

  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#2F8D7F",
      });
    }

    const response = await Notifications.requestPermissionsAsync();
    const granted = !!response.granted;
    if (granted) await configureNotificationActions();
    return granted;
  } catch (_error) {
    return false;
  }
}

function processNotificationResponse(response, handlers) {
  if (!response) return;
  const { clockIn, clockOut, switchProject, setSuggestedProject, setTrackingNotice } = handlers;
  const action = response.actionIdentifier;
  const data = response.notification?.request?.content?.data || {};

  if (action === CLOCK_OUT_NOTIFICATION_ACTION) {
    clockOut?.("notification").catch(() => {});
    return;
  }

  if (action === SWITCH_PROJECT_NOTIFICATION_ACTION) {
    const suggested = normalizeProject(data.suggestedProject);
    if (suggested) switchProject?.(suggested).catch(() => {});
    return;
  }

  // Arrival prompt: the "Clock In" action button or a plain tap on the
  // notification body both start a shift at the job site they arrived at.
  if (action === CLOCK_IN_NOTIFICATION_ACTION || data.type === "arrival") {
    const project = normalizeProject(data.project);
    if (project && clockIn) {
      clockIn(project).catch(() => {});
      setTrackingNotice?.({
        type: "arrival",
        message: `Clocking you in to ${project.name || "the job"}.`,
        createdAt: new Date().toISOString(),
      });
    }
    return;
  }

  if (data.type === "switch_project") {
    const suggested = normalizeProject(data.suggestedProject);
    if (suggested) setSuggestedProject?.(suggested);
    setTrackingNotice?.({
      type: "switch_project",
      message: suggested ? `Looks like you may be at ${suggested.name}.` : "You may be near another job.",
      suggestedProject: suggested,
      createdAt: new Date().toISOString(),
    });
  } else if (data.type === "clock_out") {
    setTrackingNotice?.({
      type: "clock_out",
      message: "You may be away from this job. Clock out if you are done.",
      createdAt: new Date().toISOString(),
    });
  }
}

// Guards against handling the same notification response twice — both within a
// session and across a cold start, where the launching response is returned by
// both the live listener and getLastNotificationResponseAsync().
const handledResponseIds = new Set();

async function dispatchNotificationResponse(response, handlers) {
  if (!response) return;
  const id = response.notification?.request?.identifier || null;
  if (id) {
    if (handledResponseIds.has(id)) return;
    handledResponseIds.add(id);
    const lastHandled = await readLastHandledNotificationId();
    if (id === lastHandled) return;
    await writeLastHandledNotificationId(id);
  }
  processNotificationResponse(response, handlers);
}

export function subscribeToTrackingNotificationResponses(handlers) {
  if (Platform.OS === "web") {
    return { remove() {} };
  }

  return Notifications.addNotificationResponseReceivedListener((response) => {
    dispatchNotificationResponse(response, handlers);
  });
}

// Handle a notification the user tapped to cold-launch the app, which the live
// listener may miss because it was registered after launch.
export async function consumeInitialNotificationResponse(handlers) {
  if (Platform.OS === "web") return;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    await dispatchNotificationResponse(response, handlers);
  } catch (_error) {
    // Non-fatal.
  }
}
