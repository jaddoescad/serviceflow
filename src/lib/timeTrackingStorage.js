import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "ottawaPainters.timeTracking.v1";
const WRITE_QUEUE_KEY = "ottawaPainters.timeTracking.writeQueue.v1";
const GEOCODE_CACHE_KEY = "ottawaPainters.projectGeocodes.v1";
const LOCATION_LABEL_CACHE_KEY = "ottawaPainters.locationLabels.v1";

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

export async function readStore() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return parseJson(raw, { activeShift: null, entries: [], knownProjects: [], lastNotificationAt: 0 });
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

export async function readGeocodeCache() {
  const raw = await AsyncStorage.getItem(GEOCODE_CACHE_KEY);
  const cache = parseJson(raw, {});
  return cache && typeof cache === "object" ? cache : {};
}

export async function writeGeocodeCache(cache) {
  await AsyncStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
}

export async function readLocationLabelCache() {
  const raw = await AsyncStorage.getItem(LOCATION_LABEL_CACHE_KEY);
  const cache = parseJson(raw, {});
  return cache && typeof cache === "object" ? cache : {};
}

export async function writeLocationLabelCache(cache) {
  await AsyncStorage.setItem(LOCATION_LABEL_CACHE_KEY, JSON.stringify(cache));
}
