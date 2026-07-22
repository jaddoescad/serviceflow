export async function notifyIfNeeded() {
  return false;
}

export async function notifyArrival() {
  return false;
}

export async function cancelActiveShiftReminders() {}

export async function ensureActiveShiftReminders() {}

export async function requestNotificationPermissions() {
  return false;
}

export function subscribeToTrackingNotificationResponses() {
  return { remove() {} };
}

export async function consumeInitialNotificationResponse() {}
