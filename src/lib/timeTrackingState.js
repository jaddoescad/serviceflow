const MAX_CLOSED_SHIFT_IDS = 64;

export function shiftStorageId(shift) {
  return String(
    shift?.localId ||
      shift?.client_entry_id ||
      shift?.serverId ||
      shift?.id ||
      "",
  );
}

export function normalizeTimeTrackingStore(value) {
  const store = value && typeof value === "object" ? value : {};
  return {
    ...store,
    activeShift: store.activeShift || null,
    entries: Array.isArray(store.entries) ? store.entries : [],
    knownProjects: Array.isArray(store.knownProjects) ? store.knownProjects : [],
    lastNotificationAt: Number(store.lastNotificationAt || 0),
    closedShiftIds: uniqueIds(store.closedShiftIds).slice(-MAX_CLOSED_SHIFT_IDS),
  };
}

export function isShiftActiveInStore(value, shift) {
  const store = normalizeTimeTrackingStore(value);
  const id = shiftStorageId(shift);
  return Boolean(
    id &&
      shiftStorageId(store.activeShift) === id &&
      !store.closedShiftIds.includes(id),
  );
}

export function startShiftInStore(value, shift, fields = {}) {
  const store = normalizeTimeTrackingStore(value);
  const id = shiftStorageId(shift);
  const currentId = shiftStorageId(store.activeShift);

  if (!id || store.closedShiftIds.includes(id) || (currentId && currentId !== id)) {
    return { applied: false, store };
  }

  return {
    applied: true,
    store: {
      ...store,
      ...safeStoreFields(fields),
      activeShift: shift,
    },
  };
}

export function updateActiveShiftInStore(value, expectedShift, nextShift, fields = {}) {
  const store = normalizeTimeTrackingStore(value);
  const expectedId = shiftStorageId(expectedShift);
  const nextId = shiftStorageId(nextShift);

  if (
    !expectedId ||
    nextId !== expectedId ||
    !isShiftActiveInStore(store, expectedShift)
  ) {
    return { applied: false, store };
  }

  return {
    applied: true,
    store: {
      ...store,
      ...safeStoreFields(fields),
      activeShift: nextShift,
    },
  };
}

export function closeShiftInStore(value, shift, completedEntry = null, fields = {}) {
  const store = normalizeTimeTrackingStore(value);
  const id = shiftStorageId(shift);
  if (!id) return { applied: false, store };

  const currentId = shiftStorageId(store.activeShift);
  const entries = completedEntry
    ? mergeCompletedEntry(store.entries, completedEntry)
    : store.entries;

  return {
    // Closing is terminal even if another task already cleared the active slot.
    applied: true,
    store: {
      ...store,
      ...safeStoreFields(fields),
      activeShift: currentId === id ? null : store.activeShift,
      entries,
      closedShiftIds: rememberClosedShift(store.closedShiftIds, id),
    },
  };
}

export function switchShiftInStore(
  value,
  expectedShift,
  nextShift,
  completedEntry = null,
  fields = {},
) {
  const store = normalizeTimeTrackingStore(value);
  const expectedId = shiftStorageId(expectedShift);
  const nextId = shiftStorageId(nextShift);

  if (
    !expectedId ||
    !nextId ||
    expectedId === nextId ||
    store.closedShiftIds.includes(nextId) ||
    !isShiftActiveInStore(store, expectedShift)
  ) {
    return { applied: false, store };
  }

  return {
    applied: true,
    store: {
      ...store,
      ...safeStoreFields(fields),
      activeShift: nextShift,
      entries: completedEntry
        ? mergeCompletedEntry(store.entries, completedEntry)
        : store.entries,
      closedShiftIds: rememberClosedShift(store.closedShiftIds, expectedId),
    },
  };
}

export function mergeCompletedEntryInStore(value, entry) {
  const store = normalizeTimeTrackingStore(value);
  return {
    ...store,
    entries: mergeCompletedEntry(store.entries, entry),
  };
}

export function mergeStoreFields(value, fields = {}) {
  const store = normalizeTimeTrackingStore(value);
  return { ...store, ...safeStoreFields(fields) };
}

export function trackingRegionsSignature(regions = []) {
  return JSON.stringify(
    regions.map((region) => [
      String(region?.identifier || ""),
      finiteOrNull(region?.latitude),
      finiteOrNull(region?.longitude),
      finiteOrNull(region?.radius),
      Boolean(region?.notifyOnEnter),
      Boolean(region?.notifyOnExit),
    ]),
  );
}

export function queuedWriteIntent(operation) {
  if (operation?.action === "delete") return "delete";
  if (operation?.action === "adjust" || operation?.action === "replace") return "replace";
  if (
    operation?.action === "clock_out" ||
    operation?.action === "switch" ||
    operation?.action === "complete" ||
    operation?.payload?.status === "complete"
  ) {
    return "complete";
  }
  return "active";
}

export function queuedWriteGroup(operation) {
  const intent = queuedWriteIntent(operation);
  if (intent === "delete") return "deletion";
  if (intent === "replace") return "adjustment";
  return "lifecycle";
}

export function chooseQueuedWrite(existing, incoming) {
  if (!existing) return incoming;
  const priority = { active: 1, complete: 2, replace: 3, delete: 4 };
  return priority[queuedWriteIntent(incoming)] >= priority[queuedWriteIntent(existing)]
    ? incoming
    : existing;
}

function mergeCompletedEntry(entries, entry) {
  const id = shiftStorageId(entry);
  if (!id) return entries;
  return [entry, ...entries.filter((item) => shiftStorageId(item) !== id)];
}

function rememberClosedShift(ids, id) {
  return [...uniqueIds(ids).filter((value) => value !== id), id].slice(
    -MAX_CLOSED_SHIFT_IDS,
  );
}

function uniqueIds(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean)));
}

function safeStoreFields(fields) {
  if (!fields || typeof fields !== "object") return {};
  const { activeShift: _activeShift, closedShiftIds: _closedShiftIds, ...safe } = fields;
  return safe;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
