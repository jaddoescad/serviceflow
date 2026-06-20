import * as Notifications from "expo-notifications";
import { formatDistance, normalizeProject } from "./trackingModel";

const CLOCK_OUT_NOTIFICATION_CATEGORY = "ottawa-painters-clock-out-prompt";
const SWITCH_PROJECT_NOTIFICATION_CATEGORY = "ottawa-painters-switch-project-prompt";
const CLOCK_OUT_NOTIFICATION_ACTION = "clock_out";
const SWITCH_PROJECT_NOTIFICATION_ACTION = "switch_project";
const NOTIFICATION_COOLDOWN_MS = 10 * 60 * 1000;

export async function notifyIfNeeded(store, status, shift) {
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

async function configureNotificationActions() {
  try {
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
  try {
    const response = await Notifications.requestPermissionsAsync();
    const granted = !!response.granted;
    if (granted) await configureNotificationActions();
    return granted;
  } catch (_error) {
    return false;
  }
}

export function subscribeToTrackingNotificationResponses({
  clockOut,
  switchProject,
  setSuggestedProject,
  setTrackingNotice,
}) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const action = response.actionIdentifier;
    const data = response.notification.request.content.data || {};

    if (action === CLOCK_OUT_NOTIFICATION_ACTION) {
      clockOut("notification").catch(() => {});
      return;
    }

    if (action === SWITCH_PROJECT_NOTIFICATION_ACTION) {
      const suggested = normalizeProject(data.suggestedProject);
      if (suggested) switchProject(suggested).catch(() => {});
      return;
    }

    if (data.type === "switch_project") {
      const suggested = normalizeProject(data.suggestedProject);
      if (suggested) setSuggestedProject(suggested);
      setTrackingNotice({
        type: "switch_project",
        message: suggested ? `Looks like you may be at ${suggested.name}.` : "You may be near another job.",
        suggestedProject: suggested,
        createdAt: new Date().toISOString(),
      });
    } else if (data.type === "clock_out") {
      setTrackingNotice({
        type: "clock_out",
        message: "You may be away from this job. Clock out if you are done.",
        createdAt: new Date().toISOString(),
      });
    }
  });
}
