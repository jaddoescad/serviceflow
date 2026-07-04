import { supabase } from "./supabase";
import { entryProjectId, shiftToEntry } from "./timeEntryModel";
import {
  enqueueWrite,
  readQueuedDeleteKeys,
  readWriteQueue,
  writeWriteQueue,
} from "./timeTrackingStorage";

function supabasePayload(entry, status) {
  return {
    client_entry_id: entry.localId || entry.id || entry.serverId,
    user_id: entry.userId,
    user_email: entry.userEmail,
    user_name: entry.userName,
    companycam_project_id: entryProjectId(entry) || null,
    project_name: entry.project?.name || "Project",
    project_address: entry.project?.formatted_address || entry.project?.address || null,
    original_started_at: entry.originalStartedAt || entry.startedAt,
    started_at: entry.startedAt,
    start_edited_at: entry.startEditedAt || null,
    ended_at: status === "active" ? null : entry.endedAt,
    status,
    clock_in_latitude: entry.startedLocation?.latitude ?? null,
    clock_in_longitude: entry.startedLocation?.longitude ?? null,
    clock_out_latitude: entry.lastLocation?.latitude ?? null,
    clock_out_longitude: entry.lastLocation?.longitude ?? null,
    last_distance_meters: entry.lastDistanceMeters ?? null,
    is_on_site: entry.onSite,
    segments: entry.segments || [],
    adjustment_history: entry.adjustmentHistory || [],
  };
}

export async function insertActiveEntry(shift) {
  if (!shift.userId) return null;
  try {
    const entry = shiftToEntry(shift, new Date().toISOString(), "active");
    const payload = supabasePayload(entry, "active");
    const { data, error } = await supabase
      .from("time_entries")
      .upsert(payload, { onConflict: "client_entry_id" })
      .select("id")
      .single();
    if (error) {
      await enqueueWrite({ action: "upsert", payload });
      return null;
    }
    return data?.id || null;
  } catch (_error) {
    await enqueueWrite({ action: "upsert", payload: supabasePayload(shiftToEntry(shift, new Date().toISOString(), "active"), "active") });
    return null;
  }
}

export async function completeEntry(entry) {
  const payload = supabasePayload(entry, "complete");
  try {
    if (entry.serverId) {
      const { error } = await supabase.from("time_entries").update(payload).eq("id", entry.serverId);
      if (error) await enqueueWrite({ action: "upsert", payload });
    } else {
      const { error } = await supabase.from("time_entries").upsert(payload, { onConflict: "client_entry_id" });
      if (error) await enqueueWrite({ action: "upsert", payload });
    }
  } catch (_error) {
    await enqueueWrite({ action: "upsert", payload });
  }
}

export async function deleteServerEntry(entry) {
  const possibleServerId = entry?.serverId || entry?.id;
  const serverId = isUuid(possibleServerId) ? possibleServerId : null;
  const clientEntryId = entry?.localId || entry?.client_entry_id;
  const deleteOperation = {
    action: "delete",
    id: serverId,
    client_entry_id: clientEntryId,
  };

  try {
    if (serverId) {
      const { error } = await supabase.from("time_entries").delete().eq("id", serverId);
      if (error) await enqueueWrite(deleteOperation);
      return !error;
    }

    if (clientEntryId) {
      const { error } = await supabase.from("time_entries").delete().eq("client_entry_id", clientEntryId);
      if (error) await enqueueWrite(deleteOperation);
      return !error;
    }
  } catch (_error) {
    if (serverId || clientEntryId) await enqueueWrite(deleteOperation);
    return false;
  }

  return false;
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

export async function persistUpdatedEntry(entry) {
  const status = entry.clockOutReason === "active" || !entry.endedAt ? "active" : "complete";
  const payload = supabasePayload(entry, status);

  try {
    if (entry.serverId && isUuid(entry.serverId)) {
      const { error } = await supabase.from("time_entries").update(payload).eq("id", entry.serverId);
      if (error) {
        await enqueueWrite({ action: "upsert", payload });
        return false;
      }
      return true;
    }

    const { error } = await supabase.from("time_entries").upsert(payload, { onConflict: "client_entry_id" });
    if (error) {
      await enqueueWrite({ action: "upsert", payload });
      return false;
    }
    return true;
  } catch (_error) {
    await enqueueWrite({ action: "upsert", payload });
    return false;
  }
}

export async function updateActiveLocation(shift) {
  const payload = supabasePayload(shiftToEntry(shift, new Date().toISOString(), "active"), "active");
  try {
    if (shift?.serverId) {
      const { error } = await supabase
        .from("time_entries")
        .update({
          clock_out_latitude: shift.lastLocation?.latitude ?? null,
          clock_out_longitude: shift.lastLocation?.longitude ?? null,
          last_distance_meters: shift.lastDistanceMeters ?? null,
          is_on_site: shift.onSite,
          segments: shift.segments || [],
          updated_at: new Date().toISOString(),
        })
        .eq("id", shift.serverId);
      if (error) await enqueueWrite({ action: "upsert", payload });
    } else {
      const { error } = await supabase.from("time_entries").upsert(payload, { onConflict: "client_entry_id" });
      if (error) await enqueueWrite({ action: "upsert", payload });
    }
  } catch (_error) {
    await enqueueWrite({ action: "upsert", payload });
  }
}

// Identifies a queued operation instance uniquely so we can remove only the
// ops that actually succeeded, even if new ops (with a fresh createdAt) were
// enqueued for the same entry mid-flush.
function flushOperationKey(operation) {
  const key =
    operation.client_entry_id ||
    operation.payload?.client_entry_id ||
    operation.payload?.id ||
    operation.id ||
    operation.createdAt;
  return `${key || ""}::${operation.createdAt || ""}`;
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
    const opKey = flushOperationKey(operation);
    try {
      if (operation.action === "upsert") {
        const { error } = await supabase
          .from("time_entries")
          .upsert(operation.payload, { onConflict: "client_entry_id" });
        if (!error) succeeded.add(opKey);
      } else if (operation.action === "delete") {
        let query = supabase.from("time_entries").delete();

        if (operation.id) {
          query = query.eq("id", operation.id);
        } else if (operation.client_entry_id) {
          query = query.eq("client_entry_id", operation.client_entry_id);
        } else {
          // Nothing to target; treat as done so it does not linger forever.
          succeeded.add(opKey);
          continue;
        }

        const { error } = await query;
        if (!error) succeeded.add(opKey);
      }
      // Unknown actions are left in the queue untouched.
    } catch (_error) {
      // Leave the op queued for a later retry.
    }
  }

  // Re-read the queue and drop only the ops we confirmed; this preserves any
  // ops enqueued mid-flush instead of clobbering them with a stale snapshot.
  const latest = await readWriteQueue();
  const remaining = latest.filter((operation) => !succeeded.has(flushOperationKey(operation)));
  await writeWriteQueue(remaining);
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
