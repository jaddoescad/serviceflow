import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  chooseQueuedWrite,
  closeShiftInStore,
  isShiftActiveInStore,
  mergeCompletedEntryInStore,
  mergeStoreFields,
  normalizeTimeTrackingStore,
  queuedWriteGroup,
  startShiftInStore,
  switchShiftInStore,
  updateActiveShiftInStore,
} from "./timeTrackingState";

const STORAGE_KEY = "ottawaPainters.timeTracking.v1";
const WRITE_QUEUE_KEY = "ottawaPainters.timeTracking.writeQueue.v1";
const GEOCODE_CACHE_KEY = "ottawaPainters.projectGeocodes.v1";
// Kept in dedicated keys (not the main store) so the time-tracking hook's
// full-store writes can never clobber geofence/notification bookkeeping that is
// written from the background geofence task.
const ARRIVAL_PROMPTS_KEY = "ottawaPainters.arrivalPrompts.v1";
const LAST_NOTIFICATION_RESPONSE_KEY = "ottawaPainters.lastHandledNotification.v1";
const LOCATION_QUEUE_KEY = "ottawaPainters.locationPointQueue.v1";
const TRACKING_STATUS_KEY = "ottawaPainters.pendingTrackingStatus.v1";
const TRACKING_RUNTIME_KEY = "ottawaPainters.trackingRuntime.v1";
const OVER_BUDGET_REASON_ANSWERED_PREFIX =
  "ottawaPainters.labourTaskOverBudgetReasonAnswered.v1";
const MAX_LOCATION_QUEUE_SIZE = 2000;

let locationQueueMutation = Promise.resolve();
let trackingStateMutation = Promise.resolve();
let writeQueueMutation = Promise.resolve();

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function overBudgetReasonAnsweredKey(userId, taskId, budgetRevision) {
  if (!userId || !taskId) return null;
  const hasBudgetRevision =
    budgetRevision !== null && budgetRevision !== undefined && budgetRevision !== "";
  const numericRevision = Number(budgetRevision);
  const revision =
    hasBudgetRevision && Number.isInteger(numericRevision)
      ? numericRevision
      : "unpublished";
  return `${OVER_BUDGET_REASON_ANSWERED_PREFIX}:${String(userId)}:${String(taskId)}:${revision}`;
}

export async function hasAnsweredLabourTaskOverBudgetReason(
  userId,
  taskId,
  budgetRevision,
) {
  const key = overBudgetReasonAnsweredKey(userId, taskId, budgetRevision);
  if (!key) return false;
  try {
    return Boolean(await AsyncStorage.getItem(key));
  } catch (_error) {
    return false;
  }
}

export async function markLabourTaskOverBudgetReasonAnswered(
  userId,
  taskId,
  budgetRevision,
) {
  const key = overBudgetReasonAnsweredKey(userId, taskId, budgetRevision);
  if (!key) return false;
  try {
    await AsyncStorage.setItem(key, new Date().toISOString());
    return true;
  } catch (_error) {
    // Prompt de-duplication is best effort and must not block stopping a timer.
    return false;
  }
}

async function readStoreSnapshot() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return normalizeTimeTrackingStore(parseJson(raw, null));
  } catch (_error) {
    return normalizeTimeTrackingStore(null);
  }
}

async function writeStoreSnapshot(store) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function runTrackingStateMutation(work) {
  const next = trackingStateMutation.catch(() => {}).then(work);
  trackingStateMutation = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function readStore() {
  await trackingStateMutation;
  return readStoreSnapshot();
}

export function persistStoreFields(fields) {
  return runTrackingStateMutation(async () => {
    const next = mergeStoreFields(await readStoreSnapshot(), fields);
    await writeStoreSnapshot(next);
    return next;
  });
}

export function startStoredShift(shift, fields = {}) {
  return runTrackingStateMutation(async () => {
    const transition = startShiftInStore(await readStoreSnapshot(), shift, fields);
    if (transition.applied) await writeStoreSnapshot(transition.store);
    return transition;
  });
}

export function updateStoredActiveShift(expectedShift, nextShift, fields = {}) {
  return runTrackingStateMutation(async () => {
    const transition = updateActiveShiftInStore(
      await readStoreSnapshot(),
      expectedShift,
      nextShift,
      fields,
    );
    if (transition.applied) await writeStoreSnapshot(transition.store);
    return transition;
  });
}

export function closeStoredShift(shift, completedEntry = null, fields = {}) {
  return runTrackingStateMutation(async () => {
    const transition = closeShiftInStore(
      await readStoreSnapshot(),
      shift,
      completedEntry,
      fields,
    );
    if (transition.applied) await writeStoreSnapshot(transition.store);
    return transition;
  });
}

export function switchStoredShift(
  expectedShift,
  nextShift,
  completedEntry = null,
  fields = {},
) {
  return runTrackingStateMutation(async () => {
    const transition = switchShiftInStore(
      await readStoreSnapshot(),
      expectedShift,
      nextShift,
      completedEntry,
      fields,
    );
    if (transition.applied) await writeStoreSnapshot(transition.store);
    return transition;
  });
}

export function persistCompletedEntry(entry) {
  return runTrackingStateMutation(async () => {
    const next = mergeCompletedEntryInStore(await readStoreSnapshot(), entry);
    await writeStoreSnapshot(next);
    return next;
  });
}

export async function isStoredShiftActive(shift) {
  return isShiftActiveInStore(await readStore(), shift);
}

async function readWriteQueueSnapshot() {
  const raw = await AsyncStorage.getItem(WRITE_QUEUE_KEY);
  const queue = parseJson(raw, []);
  return Array.isArray(queue) ? queue : [];
}

function runWriteQueueMutation(work) {
  const next = writeQueueMutation.catch(() => {}).then(async () => {
    const queue = await readWriteQueueSnapshot();
    const updated = await work(queue);
    if (updated !== queue) {
      await AsyncStorage.setItem(WRITE_QUEUE_KEY, JSON.stringify(updated));
    }
    return updated;
  });
  writeQueueMutation = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function readWriteQueue() {
  await writeQueueMutation;
  return readWriteQueueSnapshot();
}

function queueKey(operation) {
  const identity = (
    operation.client_entry_id ||
    operation.payload?.client_entry_id ||
    operation.payload?.id ||
    operation.id ||
    operation.createdAt
  );
  return identity ? `${identity}::${queuedWriteGroup(operation)}` : null;
}

export async function enqueueWrite(operation) {
  const incoming = {
    ...operation,
    createdAt: operation.createdAt || new Date().toISOString(),
  };

  return runWriteQueueMutation(async (queue) => {
    const key = queueKey(incoming);
    if (!key) return [...queue, incoming];
    const existing = queue.find((item) => queueKey(item) === key);
    const winner = chooseQueuedWrite(existing, incoming);
    if (winner === existing) return queue;
    return [...queue.filter((item) => queueKey(item) !== key), winner];
  });
}

export function queuedWriteInstanceKey(operation) {
  return `${queueKey(operation) || ""}::${operation?.createdAt || ""}`;
}

export function removeQueuedWrites(instanceKeys) {
  const completed = new Set(instanceKeys || []);
  if (!completed.size) return Promise.resolve();
  return runWriteQueueMutation(async (queue) =>
    queue.filter((operation) => !completed.has(queuedWriteInstanceKey(operation))),
  );
}

export async function readQueuedDeleteKeys() {
  const queue = await readWriteQueue();
  const ids = new Set();
  const clientEntryIds = new Set();

  for (const operation of queue) {
    if (operation.action !== "delete") continue;
    const id = operation.payload?.server_id || operation.id;
    const clientEntryId =
      operation.payload?.client_entry_id || operation.client_entry_id;
    if (id) ids.add(String(id));
    if (clientEntryId) clientEntryIds.add(String(clientEntryId));
  }

  return { ids, clientEntryIds };
}

export async function readArrivalPrompts() {
  try {
    const raw = await AsyncStorage.getItem(ARRIVAL_PROMPTS_KEY);
    const value = parseJson(raw, {});
    return value && typeof value === "object" ? value : {};
  } catch (_error) {
    return {};
  }
}

export async function writeArrivalPrompts(prompts) {
  try {
    await AsyncStorage.setItem(ARRIVAL_PROMPTS_KEY, JSON.stringify(prompts || {}));
  } catch (_error) {
    // Non-fatal; arrival de-duplication is best-effort.
  }
}

export async function readLastHandledNotificationId() {
  try {
    return (await AsyncStorage.getItem(LAST_NOTIFICATION_RESPONSE_KEY)) || null;
  } catch (_error) {
    return null;
  }
}

export async function writeLastHandledNotificationId(id) {
  try {
    if (id) await AsyncStorage.setItem(LAST_NOTIFICATION_RESPONSE_KEY, String(id));
  } catch (_error) {
    // Non-fatal.
  }
}

export async function readGeocodeCache() {
  const raw = await AsyncStorage.getItem(GEOCODE_CACHE_KEY);
  const cache = parseJson(raw, {});
  return cache && typeof cache === "object" ? cache : {};
}

export async function writeGeocodeCache(cache) {
  await AsyncStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
}

export async function readLocationQueue() {
  try {
    const raw = await AsyncStorage.getItem(LOCATION_QUEUE_KEY);
    const queue = parseJson(raw, []);
    return Array.isArray(queue) ? queue : [];
  } catch (_error) {
    return [];
  }
}

export async function enqueueLocationPoints(points) {
  const additions = (Array.isArray(points) ? points : [points]).filter(Boolean);
  if (!additions.length) return;

  locationQueueMutation = locationQueueMutation.then(async () => {
    const current = await readLocationQueue();
    const byEventId = new Map();
    [...current, ...additions].forEach((point) => {
      if (point?.client_event_id) byEventId.set(point.client_event_id, point);
    });
    const next = Array.from(byEventId.values()).slice(-MAX_LOCATION_QUEUE_SIZE);
    await AsyncStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(next));
  });

  return locationQueueMutation;
}

export async function removeLocationPoints(clientEventIds) {
  const completed = new Set((clientEventIds || []).map(String));
  if (!completed.size) return;

  locationQueueMutation = locationQueueMutation.then(async () => {
    const current = await readLocationQueue();
    const next = current.filter((point) => !completed.has(String(point?.client_event_id || "")));
    await AsyncStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(next));
  });

  return locationQueueMutation;
}

export async function readPendingTrackingStatus() {
  try {
    const raw = await AsyncStorage.getItem(TRACKING_STATUS_KEY);
    const status = parseJson(raw, null);
    return status && typeof status === "object" ? status : null;
  } catch (_error) {
    return null;
  }
}

export function writePendingTrackingStatus(status, options = {}) {
  return runTrackingStateMutation(async () => {
    if (
      options.expectedActiveShift &&
      !isShiftActiveInStore(await readStoreSnapshot(), options.expectedActiveShift)
    ) {
      return false;
    }
    if (options.expectedStatus) {
      const current = parseJson(await AsyncStorage.getItem(TRACKING_STATUS_KEY), null);
      if (trackingStatusKey(current) !== trackingStatusKey(options.expectedStatus)) {
        return false;
      }
    }
    if (!status) {
      await AsyncStorage.removeItem(TRACKING_STATUS_KEY);
      return true;
    }
    await AsyncStorage.setItem(TRACKING_STATUS_KEY, JSON.stringify(status));
    return true;
  });
}

function trackingStatusKey(status) {
  if (!status) return "";
  return [
    status.client_entry_id || "",
    status.tracking_mode || "",
    status.task_status || "",
    status.last_sync_at || "",
  ].join("::");
}

async function readTrackingRuntimeSnapshot() {
  try {
    const raw = await AsyncStorage.getItem(TRACKING_RUNTIME_KEY);
    const state = parseJson(raw, {});
    return state && typeof state === "object" ? state : {};
  } catch (_error) {
    return {};
  }
}

export async function readTrackingRuntimeState() {
  await trackingStateMutation;
  return readTrackingRuntimeSnapshot();
}

export function mergeTrackingRuntimeState(updates, options = {}) {
  return runTrackingStateMutation(async () => {
    if (
      options.expectedActiveShift &&
      !isShiftActiveInStore(await readStoreSnapshot(), options.expectedActiveShift)
    ) {
      return null;
    }
    const current = await readTrackingRuntimeSnapshot();
    const next = { ...current, ...(updates || {}), updatedAt: new Date().toISOString() };
    await AsyncStorage.setItem(TRACKING_RUNTIME_KEY, JSON.stringify(next));
    return next;
  });
}
