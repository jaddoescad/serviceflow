import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "ottawaPainters.timeTracking.v1";
const WRITE_QUEUE_KEY = "ottawaPainters.timeTracking.writeQueue.v1";
const GEOCODE_CACHE_KEY = "ottawaPainters.projectGeocodes.v1";
// Kept in dedicated keys (not the main store) so the time-tracking hook's
// full-store writes can never clobber geofence/notification bookkeeping that is
// written from the background geofence task.
const ARRIVAL_PROMPTS_KEY = "ottawaPainters.arrivalPrompts.v1";
const LAST_NOTIFICATION_RESPONSE_KEY = "ottawaPainters.lastHandledNotification.v1";

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

export async function readStore() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return parseJson(raw, { activeShift: null, entries: [], knownProjects: [], lastNotificationAt: 0 });
  } catch (_error) {
    return { activeShift: null, entries: [], knownProjects: [], lastNotificationAt: 0 };
  }
}

export async function writeStore(store) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export async function readWriteQueue() {
  const raw = await AsyncStorage.getItem(WRITE_QUEUE_KEY);
  const queue = parseJson(raw, []);
  return Array.isArray(queue) ? queue : [];
}

export async function writeWriteQueue(queue) {
  await AsyncStorage.setItem(WRITE_QUEUE_KEY, JSON.stringify(queue));
}

function queueKey(operation) {
  return (
    operation.client_entry_id ||
    operation.payload?.client_entry_id ||
    operation.payload?.id ||
    operation.id ||
    operation.createdAt
  );
}

export async function enqueueWrite(operation) {
  const queue = await readWriteQueue();
  const key = queueKey(operation);

  // A straggling upsert must not cancel an already-queued delete for the same
  // entry. Keep the delete and drop the incoming upsert.
  if (key && operation.action === "upsert") {
    const hasQueuedDelete = queue.some(
      (item) => item.action === "delete" && queueKey(item) === key,
    );
    if (hasQueuedDelete) return;
  }

  const withoutDuplicate = key
    ? queue.filter((item) => queueKey(item) !== key)
    : queue;
  await writeWriteQueue([...withoutDuplicate, { ...operation, createdAt: operation.createdAt || new Date().toISOString() }]);
}

export async function readQueuedDeleteKeys() {
  const queue = await readWriteQueue();
  const ids = new Set();
  const clientEntryIds = new Set();

  for (const operation of queue) {
    if (operation.action !== "delete") continue;
    if (operation.id) ids.add(String(operation.id));
    if (operation.client_entry_id) clientEntryIds.add(String(operation.client_entry_id));
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
