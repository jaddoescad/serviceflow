import { supabase } from "./supabase";
import { entryProjectId, shiftToEntry } from "./timeEntryModel";
import {
  enqueueWrite,
  queuedWriteInstanceKey,
  readQueuedDeleteKeys,
  readWriteQueue,
  removeQueuedWrites,
} from "./timeTrackingStorage";

function commandPayload(entry, options = {}) {
  const serverId = isUuid(entry?.serverId || entry?.id)
    ? entry.serverId || entry.id
    : null;
  return {
    client_entry_id: entry.localId || entry.id || entry.serverId,
    server_id: serverId,
    user_name: entry.userName,
    companycam_project_id: entryProjectId(entry) || null,
    project_name: entry.project?.name || "Project",
    project_address: entry.project?.formatted_address || entry.project?.address || null,
    original_started_at: entry.originalStartedAt || entry.startedAt,
    started_at: entry.startedAt,
    ended_at: options.includeEndedAt ? entry.endedAt : undefined,
    clock_in_latitude: entry.startedLocation?.latitude ?? null,
    clock_in_longitude: entry.startedLocation?.longitude ?? null,
    clock_out_latitude: entry.lastLocation?.latitude ?? null,
    clock_out_longitude: entry.lastLocation?.longitude ?? null,
    last_distance_meters: entry.lastDistanceMeters ?? null,
    is_on_site: entry.onSite,
    segments: entry.segments || [],
    reason: options.reason || entry.clockOutReason || null,
    source: options.source || "mobile",
    adjustment_source: options.adjustmentSource || null,
  };
}

export async function insertActiveEntry(shift) {
  if (!shift.userId) return null;
  const payload = commandPayload(
    shiftToEntry(shift, new Date().toISOString(), "active"),
  );
  try {
    const { data, error } = await supabase.rpc("clock_in_time_entry", {
      command: payload,
    });
    if (error) {
      await enqueueWrite({ action: "clock_in", payload });
      return null;
    }
    const row = normalizeRpcRow(data);
    return row?.status === "active" && !row?.ended_at ? row.id : null;
  } catch (_error) {
    await enqueueWrite({ action: "clock_in", payload });
    return null;
  }
}

export async function completeEntry(entry) {
  const payload = commandPayload(entry, {
    includeEndedAt: true,
    reason: entry.clockOutReason,
  });
  try {
    const { data, error } = await supabase.rpc("clock_out_time_entry", {
      command: payload,
    });
    if (error) {
      await enqueueWrite({ action: "clock_out", payload });
      return null;
    }
    return normalizeRpcRow(data);
  } catch (_error) {
    await enqueueWrite({ action: "clock_out", payload });
    return null;
  }
}

export async function switchEntry(completedEntry, nextShift) {
  const clockOutCommand = commandPayload(completedEntry, {
    includeEndedAt: true,
    reason: completedEntry.clockOutReason || "switched_project",
  });
  const clockInCommand = commandPayload(
    shiftToEntry(nextShift, new Date().toISOString(), "active"),
  );
  const operation = {
    action: "switch",
    client_entry_id: clockOutCommand.client_entry_id,
    next_client_entry_id: clockInCommand.client_entry_id,
    payload: {
      clock_out_command: clockOutCommand,
      clock_in_command: clockInCommand,
    },
  };

  try {
    const { data, error } = await supabase.rpc("switch_time_entry", operation.payload);
    if (error) {
      await enqueueWrite(operation);
      return null;
    }
    return {
      completedRow: normalizeRpcRow(data?.completed_entry),
      activeRow: normalizeRpcRow(data?.active_entry),
    };
  } catch (_error) {
    await enqueueWrite(operation);
    return null;
  }
}

export async function deleteServerEntry(entry) {
  const possibleServerId = entry?.serverId || entry?.id;
  const serverId = isUuid(possibleServerId) ? possibleServerId : null;
  const clientEntryId = entry?.localId || entry?.client_entry_id;
  const deleteOperation = {
    action: "delete",
    payload: {
      server_id: serverId,
      client_entry_id: clientEntryId,
    },
  };

  try {
    if (!serverId && !clientEntryId) return false;
    const { data, error } = await supabase.rpc("delete_time_entry", {
      command: deleteOperation.payload,
    });
    if (error) await enqueueWrite(deleteOperation);
    return !error && data === true;
  } catch (_error) {
    if (serverId || clientEntryId) await enqueueWrite(deleteOperation);
    return false;
  }
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

export async function persistUpdatedEntry(entry) {
  const payload = commandPayload(entry, {
    includeEndedAt: true,
    adjustmentSource: "mobile_time_edit",
  });

  try {
    const { data, error } = await supabase.rpc("adjust_time_entry", {
      command: payload,
    });
    if (error) {
      await enqueueWrite({ action: "adjust", payload });
      return null;
    }
    return normalizeRpcRow(data);
  } catch (_error) {
    await enqueueWrite({ action: "adjust", payload });
    return null;
  }
}

export async function updateActiveLocation(shift) {
  const payload = commandPayload(
    shiftToEntry(shift, new Date().toISOString(), "active"),
  );
  try {
    // Observation failures are intentionally not added to the lifecycle queue.
    // Raw location evidence has its own durable queue; a GPS callback must never
    // gain authority to create or reopen a time entry.
    const { data, error } = await supabase.rpc("record_time_entry_observation", {
      command: payload,
    });
    return error ? null : normalizeRpcRow(data);
  } catch (_error) {
    return null;
  }
}

let flushInFlight = null;

export async function flushQueuedWrites() {
  // Only one flush runs at a time; concurrent callers await the same promise.
  if (flushInFlight) return flushInFlight;
  flushInFlight = performFlush().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function performFlush() {
  const queue = await readWriteQueue();
  if (!queue.length) return;

  const succeeded = new Set();
  for (const operation of queue) {
    const opKey = queuedWriteInstanceKey(operation);
    try {
      const { error, ignored = false } = await executeQueuedOperation(operation);
      if (!error || ignored) succeeded.add(opKey);
      // Unknown actions are left in the queue untouched.
    } catch (_error) {
      // Leave the op queued for a later retry.
    }
  }

  // Removal is serialized with enqueueWrite, so a newer operation cannot be
  // dropped by a flush that started from an older queue snapshot.
  await removeQueuedWrites(succeeded);
}

async function executeQueuedOperation(operation) {
  const payload = operation.payload || {};
  if (operation.action === "clock_in" || operation.action === "create_active") {
    return supabase.rpc("clock_in_time_entry", { command: legacyCommand(operation) });
  }
  if (operation.action === "clock_out" || operation.action === "complete") {
    return supabase.rpc("clock_out_time_entry", { command: legacyCommand(operation) });
  }
  if (operation.action === "switch") {
    return supabase.rpc("switch_time_entry", payload);
  }
  if (operation.action === "adjust" || operation.action === "replace") {
    return supabase.rpc("adjust_time_entry", { command: legacyCommand(operation) });
  }
  if (operation.action === "patch_active") {
    // Old queues could replace their original create with a location patch.
    // Establish the session through the idempotent command, then submit only
    // observation fields. A completed session will be returned, never reopened.
    const command = legacyCommand(operation);
    const clockIn = await supabase.rpc("clock_in_time_entry", { command });
    if (clockIn.error) return clockIn;
    return supabase.rpc("record_time_entry_observation", { command });
  }
  if (operation.action === "upsert") {
    const command = legacyCommand(operation);
    if (payload.status === "complete" || payload.ended_at) {
      return supabase.rpc("clock_out_time_entry", { command });
    }
    return supabase.rpc("clock_in_time_entry", { command });
  }
  if (operation.action === "delete") {
    const command = {
      server_id: payload.server_id || operation.id || null,
      client_entry_id:
        payload.client_entry_id || operation.client_entry_id || null,
    };
    if (!command.server_id && !command.client_entry_id) {
      return { error: null, ignored: true };
    }
    return supabase.rpc("delete_time_entry", { command });
  }
  return { error: new Error(`Unknown queued time-entry action: ${operation.action}`) };
}

function legacyCommand(operation) {
  const payload = operation.payload || {};
  return {
    ...payload,
    server_id: payload.server_id || operation.id || null,
  };
}

function normalizeRpcRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data && typeof data === "object" ? data : null;
}

export async function fetchTimeEntryRows() {
  await flushQueuedWrites();
  const queuedDeletes = await readQueuedDeleteKeys();
  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(500);

  if (error) return null;

  return (data || []).filter((row) => {
    if (queuedDeletes.ids.has(String(row.id))) return false;
    if (queuedDeletes.clientEntryIds.has(String(row.client_entry_id))) return false;
    return true;
  });
}

export function entryFromSupabase(row) {
  const isActive = row.status === "active" && !row.ended_at;
  // Keep active rows open (endedAt: null) so presenters compute a live duration
  // instead of freezing teammate timers at fetch time.
  const endedAt = isActive ? null : row.ended_at || new Date().toISOString();
  const durationEnd = endedAt || new Date().toISOString();
  const durationMs = Math.max(0, new Date(durationEnd).getTime() - new Date(row.started_at).getTime());

  return {
    id: row.id,
    localId: row.client_entry_id || row.id,
    serverId: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    userName: row.user_name || "Painter",
    project: {
      companycam_id: row.companycam_project_id,
      id: row.companycam_project_id,
      name: row.project_name || "Project",
      address: row.project_address,
      formatted_address: row.project_address,
    },
    originalStartedAt: row.original_started_at || row.started_at,
    startedAt: row.started_at,
    startEditedAt: row.start_edited_at || null,
    endedAt,
    durationMs,
    clockOutReason: row.status === "active" ? "active" : "server",
    startedLocation:
      row.clock_in_latitude == null || row.clock_in_longitude == null
        ? null
        : { latitude: row.clock_in_latitude, longitude: row.clock_in_longitude },
    lastLocation:
      row.clock_out_latitude == null || row.clock_out_longitude == null
        ? null
        : { latitude: row.clock_out_latitude, longitude: row.clock_out_longitude },
    lastDistanceMeters: row.last_distance_meters,
    onSite: row.is_on_site,
    segments: Array.isArray(row.segments) ? row.segments : [],
    adjustmentHistory: Array.isArray(row.adjustment_history) ? row.adjustment_history : [],
  };
}

export function shiftFromSupabase(row) {
  const entry = entryFromSupabase(row);
  return {
    localId: row.client_entry_id || row.id,
    serverId: row.id,
    userId: entry.userId,
    userEmail: entry.userEmail,
    userName: entry.userName,
    project: entry.project,
    originalStartedAt: entry.originalStartedAt || entry.startedAt,
    startedAt: entry.startedAt,
    startEditedAt: entry.startEditedAt || null,
    startedLocation: entry.startedLocation,
    lastLocation: entry.lastLocation,
    lastDistanceMeters: entry.lastDistanceMeters,
    onSite: entry.onSite,
    travelStartedAt: null,
    segments: entry.segments,
    adjustmentHistory: entry.adjustmentHistory || [],
  };
}
