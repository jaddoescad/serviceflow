import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { supabase } from "./supabase";
import { distanceMeters, formatDistance, normalizeProject } from "./trackingModel";
import { activeEntry, applyEntryTimeUpdate, entryProjectId, shiftToEntry } from "./timeEntryModel";
import { getProjectTimeTotals } from "./timeEntryPresenters";
import {
  enqueueWrite,
  readGeocodeCache,
  readLocationLabelCache,
  readQueuedDeleteKeys,
  readStore,
  readWriteQueue,
  writeGeocodeCache,
  writeLocationLabelCache,
  writeStore,
  writeWriteQueue,
} from "./timeTrackingStorage";

export { distanceMeters, formatAddress, formatDistance, formatDuration, normalizeProject } from "./trackingModel";
export { buildProjectClockInDays, buildTimesheetDays, getProjectTimeTotals } from "./timeEntryPresenters";

export const BACKGROUND_LOCATION_TASK = "ottawa-painters-background-location";

const CLOCK_OUT_NOTIFICATION_CATEGORY = "ottawa-painters-clock-out-prompt";
const SWITCH_PROJECT_NOTIFICATION_CATEGORY = "ottawa-painters-switch-project-prompt";
const CLOCK_OUT_NOTIFICATION_ACTION = "clock_out";
const SWITCH_PROJECT_NOTIFICATION_ACTION = "switch_project";
const SITE_RADIUS_METERS = 150;
const CLOCK_OUT_PROMPT_METERS = 300;
const JOB_SUGGESTION_METERS = 175;
const NOTIFICATION_COOLDOWN_MS = 10 * 60 * 1000;

function compactUser(user) {
  if (!user) return { id: null, email: null, name: "Painter" };
  const email = user.email || null;
  return {
    id: user.id || null,
    email,
    name: user.name || user.full_name || user.user_metadata?.full_name || user.user_metadata?.name || (email ? email.split("@")[0] : "Painter"),
  };
}

function toPoint(location) {
  const coords = location?.coords || location;
  const latitude = Number(coords?.latitude);
  const longitude = Number(coords?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    accuracy: Number(coords.accuracy || 0) || null,
    capturedAt: new Date(location?.timestamp || Date.now()).toISOString(),
  };
}

function projectPoint(project) {
  const normalized = normalizeProject(project);
  if (!normalized || normalized.latitude == null || normalized.longitude == null) return null;
  return { latitude: normalized.latitude, longitude: normalized.longitude };
}

function locationLabelCacheKey(point) {
  if (!point) return null;
  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

function formatReverseGeocodeLabel(result) {
  if (!result) return null;
  const streetName = result.street || result.name;
  const street = [result.streetNumber, streetName].filter(Boolean).join(" ").trim();
  const city = result.city || result.district || result.subregion;
  const region = result.region || result.country;
  const label = [street, city, region].filter(Boolean).join(", ");
  return label || result.name || null;
}

async function reverseGeocodePoint(point) {
  const cacheKey = locationLabelCacheKey(point);
  if (!cacheKey) return null;

  const cache = await readLocationLabelCache();
  if (cache[cacheKey]?.label) return cache[cacheKey].label;

  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: point.latitude,
      longitude: point.longitude,
    });
    const label = formatReverseGeocodeLabel(results?.[0]);
    if (!label) return null;

    const nextCache = {
      ...cache,
      [cacheKey]: { label, resolvedAt: new Date().toISOString() },
    };
    const trimmedEntries = Object.entries(nextCache).slice(-120);
    await writeLocationLabelCache(Object.fromEntries(trimmedEntries));
    return label;
  } catch (_error) {
    return null;
  }
}

async function geocodeProject(project) {
  const normalized = normalizeProject(project);
  if (!normalized || normalized.latitude != null || normalized.longitude != null) return normalized;

  const address = normalized.formatted_address || normalized.address;
  if (!address) return normalized;

  const cacheKey = normalized.companycam_id || address;
  const cache = await readGeocodeCache();
  const cached = cache[cacheKey];
  if (cached?.latitude != null && cached?.longitude != null) {
    return { ...normalized, latitude: cached.latitude, longitude: cached.longitude };
  }

  try {
    const matches = await Location.geocodeAsync(address);
    const first = matches?.[0];
    if (!first || first.latitude == null || first.longitude == null) return normalized;

    const resolved = { ...normalized, latitude: first.latitude, longitude: first.longitude };
    await writeGeocodeCache({
      ...cache,
      [cacheKey]: { latitude: first.latitude, longitude: first.longitude, address, resolvedAt: new Date().toISOString() },
    });
    return resolved;
  } catch (_error) {
    return normalized;
  }
}

async function geocodeProjects(projects, limit = 80) {
  const output = [];
  let resolvedCount = 0;

  for (const project of projects || []) {
    const normalized = normalizeProject(project);
    if (!normalized) continue;

    if (normalized.latitude == null && normalized.longitude == null && resolvedCount < limit) {
      output.push(await geocodeProject(normalized));
      resolvedCount += 1;
    } else {
      output.push(normalized);
    }
  }

  return output;
}

function createLocationStatus(shift, projects, point) {
  const activeDistance = distanceMeters(point, projectPoint(shift.project));
  const onSite = activeDistance == null ? null : activeDistance <= SITE_RADIUS_METERS;
  let nearestProject = null;
  let nearestDistance = null;

  for (const rawProject of projects || []) {
    const project = normalizeProject(rawProject);
    const coords = projectPoint(project);
    if (!project || !coords) continue;
    const distance = distanceMeters(point, coords);
    if (distance == null) continue;
    if (nearestDistance == null || distance < nearestDistance) {
      nearestProject = project;
      nearestDistance = distance;
    }
  }

  const suggestedProject =
    nearestProject &&
    nearestProject.companycam_id !== shift.project.companycam_id &&
    nearestDistance != null &&
    nearestDistance <= JOB_SUGGESTION_METERS
      ? nearestProject
      : null;

  return {
    point,
    activeDistance,
    onSite,
    nearestProject,
    nearestDistance,
    suggestedProject,
    shouldPromptClockOut: activeDistance != null && activeDistance >= CLOCK_OUT_PROMPT_METERS,
    locationLabel: null,
    label:
      activeDistance == null
        ? "Location captured. Job-site distance unavailable."
        : onSite
          ? `On site, ${formatDistance(activeDistance)} from job.`
          : `Off site, ${formatDistance(activeDistance)} from job.`,
  };
}

async function enrichLocationStatus(status) {
  if (!status || status.onSite === true) return status;
  const locationLabel = await reverseGeocodePoint(status.point);
  if (!locationLabel) return status;

  return {
    ...status,
    locationLabel,
    label:
      status.activeDistance == null
        ? `Location captured near ${locationLabel}. Job-site distance unavailable.`
        : `Off site near ${locationLabel}, ${formatDistance(status.activeDistance)} from job.`,
  };
}

function appendSegment(shift, status) {
  const now = new Date().toISOString();
  const mode = status.onSite === false ? "off_site" : status.onSite === true ? "on_site" : "unknown";
  const segments = shift.segments || [];
  const last = segments[segments.length - 1];
  const locationLabel =
    mode === "off_site" || mode === "unknown"
      ? status.locationLabel || last?.locationLabel || null
      : null;

  if (last?.mode === mode) {
    return {
      ...shift,
      segments: [
        ...segments.slice(0, -1),
        { ...last, endedAt: now, distanceMeters: status.activeDistance, location: status.point, locationLabel },
      ],
    };
  }

  return {
    ...shift,
    segments: [
      ...segments,
      { mode, startedAt: now, endedAt: now, distanceMeters: status.activeDistance, location: status.point, locationLabel },
    ],
  };
}

function createShift(project, user, point) {
  const painter = compactUser(user);
  const normalizedProject = normalizeProject(project);
  const now = new Date().toISOString();

  return {
    localId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    serverId: null,
    userId: painter.id,
    userEmail: painter.email,
    userName: painter.name,
    project: normalizedProject,
    startedAt: now,
    startedLocation: point,
    lastLocation: point,
    lastLocationLabel: null,
    lastDistanceMeters: null,
    onSite: null,
    travelStartedAt: null,
    segments: [],
  };
}

function supabasePayload(entry, status) {
  return {
    client_entry_id: entry.localId || entry.id || entry.serverId,
    user_id: entry.userId,
    user_email: entry.userEmail,
    user_name: entry.userName,
    companycam_project_id: entryProjectId(entry) || null,
    project_name: entry.project?.name || "Project",
    project_address: entry.project?.formatted_address || entry.project?.address || null,
    started_at: entry.startedAt,
    ended_at: status === "active" ? null : entry.endedAt,
    status,
    clock_in_latitude: entry.startedLocation?.latitude ?? null,
    clock_in_longitude: entry.startedLocation?.longitude ?? null,
    clock_out_latitude: entry.lastLocation?.latitude ?? null,
    clock_out_longitude: entry.lastLocation?.longitude ?? null,
    last_distance_meters: entry.lastDistanceMeters ?? null,
    is_on_site: entry.onSite,
    segments: entry.segments || [],
  };
}

async function insertActiveEntry(shift) {
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

async function completeEntry(entry) {
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

async function deleteServerEntry(entry) {
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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

async function persistUpdatedEntry(entry) {
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

async function updateActiveLocation(shift) {
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

async function flushQueuedWrites() {
  const queue = await readWriteQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const operation of queue) {
    try {
      if (operation.action === "upsert") {
        const { error } = await supabase
          .from("time_entries")
          .upsert(operation.payload, { onConflict: "client_entry_id" });
        if (error) remaining.push(operation);
      } else if (operation.action === "delete") {
        let query = supabase.from("time_entries").delete();

        if (operation.id) {
          query = query.eq("id", operation.id);
        } else if (operation.client_entry_id) {
          query = query.eq("client_entry_id", operation.client_entry_id);
        } else {
          continue;
        }

        const { error } = await query;
        if (error) remaining.push(operation);
      } else {
        remaining.push(operation);
      }
    } catch (_error) {
      remaining.push(operation);
    }
  }

  await writeWriteQueue(remaining);
}

function entryFromSupabase(row) {
  const endedAt = row.ended_at || new Date().toISOString();
  const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(row.started_at).getTime());

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
    startedAt: row.started_at,
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
    lastLocationLabel: null,
    lastDistanceMeters: row.last_distance_meters,
    onSite: row.is_on_site,
    segments: Array.isArray(row.segments) ? row.segments : [],
  };
}

function shiftFromSupabase(row) {
  const entry = entryFromSupabase(row);
  return {
    localId: row.client_entry_id || row.id,
    serverId: row.id,
    userId: entry.userId,
    userEmail: entry.userEmail,
    userName: entry.userName,
    project: entry.project,
    startedAt: entry.startedAt,
    startedLocation: entry.startedLocation,
    lastLocation: entry.lastLocation,
    lastLocationLabel: entry.lastLocationLabel,
    lastDistanceMeters: entry.lastDistanceMeters,
    onSite: entry.onSite,
    travelStartedAt: null,
    segments: entry.segments,
  };
}

async function notifyIfNeeded(store, status, shift) {
  if (!status.shouldPromptClockOut && !status.suggestedProject) return false;
  const now = Date.now();
  if (now - Number(store.lastNotificationAt || 0) < NOTIFICATION_COOLDOWN_MS) return false;

  const title = status.suggestedProject ? "Are you at another job?" : "Still on this job?";
  const awayText = status.locationLabel ? ` near ${status.locationLabel}` : "";
  const body = status.suggestedProject
    ? `You look close to ${status.suggestedProject.name}${awayText}. Switch your clock-in if this is the new job.`
    : `You are ${formatDistance(status.activeDistance)} from ${shift.project?.name || "the job"}${awayText}. Clock out if you are done.`;
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

async function handleBackgroundLocation(location) {
  const point = toPoint(location);
  if (!point) return;

  const store = await readStore();
  const shift = store.activeShift;
  if (!shift) return;

  const status = await enrichLocationStatus(createLocationStatus(shift, store.knownProjects || [], point));
  const nextShift = appendSegment(
    {
      ...shift,
      lastLocation: point,
      lastLocationLabel: status.locationLabel || shift.lastLocationLabel || null,
      lastDistanceMeters: status.activeDistance,
      onSite: status.onSite,
      travelStartedAt: status.onSite === false && !shift.travelStartedAt ? new Date().toISOString() : shift.travelStartedAt,
    },
    status,
  );

  const didNotify = await notifyIfNeeded(store, status, nextShift);
  await writeStore({
    ...store,
    activeShift: nextShift,
    lastNotificationAt: didNotify ? Date.now() : store.lastNotificationAt || 0,
    lastNotice: {
      type: status.suggestedProject ? "switch_project" : status.shouldPromptClockOut ? "clock_out" : "status",
      message: status.label,
      suggestedProject: status.suggestedProject,
      createdAt: new Date().toISOString(),
    },
  });
  await updateActiveLocation(nextShift);
}

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const locations = data?.locations || [];
    const latest = locations[locations.length - 1];
    if (latest) await handleBackgroundLocation(latest);
  });
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

async function requestPermissions() {
  let notifications = false;
  try {
    const response = await Notifications.requestPermissionsAsync();
    notifications = !!response.granted;
    if (notifications) await configureNotificationActions();
  } catch (_error) {
    notifications = false;
  }

  let foreground = { granted: false };
  try {
    foreground = await Location.requestForegroundPermissionsAsync();
  } catch (_error) {
    foreground = { granted: false };
  }

  let background = false;
  if (foreground.granted) {
    try {
      const response = await Location.requestBackgroundPermissionsAsync();
      background = !!response.granted;
    } catch (_error) {
      background = false;
    }
  }

  return { foreground: !!foreground.granted, background, notifications };
}

async function getCurrentPoint() {
  try {
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return toPoint(location);
  } catch (_error) {
    return null;
  }
}

async function startBackgroundTracking() {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (started) return true;
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 50,
      timeInterval: 60000,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: "Ottawa Painters clock-in active",
        notificationBody: "Tracking location while you are clocked in.",
      },
    });
    return true;
  } catch (_error) {
    return false;
  }
}

async function stopBackgroundTracking() {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (started) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch (_error) {
    // Non-fatal.
  }
}

export function useTimeTracking(projects = [], user) {
  const [activeShift, setActiveShift] = useState(null);
  const [entries, setEntries] = useState([]);
  const [teamEntries, setTeamEntries] = useState([]);
  const [resolvedProjects, setResolvedProjects] = useState(projects || []);
  const [locationStatus, setLocationStatus] = useState(null);
  const [trackingNotice, setTrackingNotice] = useState(null);
  const [suggestedProject, setSuggestedProject] = useState(null);
  const [tick, setTick] = useState(Date.now());

  const activeRef = useRef(null);
  const projectsRef = useRef(projects);
  const notificationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setResolvedProjects(projects || []);

    geocodeProjects(projects || []).then((nextProjects) => {
      if (!cancelled) setResolvedProjects(nextProjects);
    });

    return () => {
      cancelled = true;
    };
  }, [projects]);

  useEffect(() => {
    projectsRef.current = resolvedProjects || [];
  }, [resolvedProjects]);

  useEffect(() => {
    activeRef.current = activeShift;
  }, [activeShift]);

  useEffect(() => {
    let mounted = true;
    readStore().then((store) => {
      if (!mounted) return;
      setActiveShift(store.activeShift || null);
      setEntries(Array.isArray(store.entries) ? store.entries : []);
      setTrackingNotice(store.lastNotice || null);
      setSuggestedProject(store.lastNotice?.suggestedProject || null);
      notificationRef.current = Number(store.lastNotificationAt || 0);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const refreshServerEntries = useCallback(async () => {
    if (!user?.id) return;

    try {
      await flushQueuedWrites();
      const queuedDeletes = await readQueuedDeleteKeys();
      const { data, error } = await supabase
        .from("time_entries")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(500);

      if (error) return;

      const rows = (data || []).filter((row) => {
        if (queuedDeletes.ids.has(String(row.id))) return false;
        if (queuedDeletes.clientEntryIds.has(String(row.client_entry_id))) return false;
        return true;
      });
      const currentUserRows = rows.filter((row) => row.user_id === user.id);
      const activeRow = currentUserRows.find((row) => row.status === "active" && !row.ended_at);
      const completed = currentUserRows
        .filter((row) => row.status !== "active" || row.ended_at)
        .map(entryFromSupabase);
      const completedKeys = new Set(completed.map((entry) => entry.serverId || entry.id || entry.localId));

      setTeamEntries(rows.map(entryFromSupabase));
      setEntries((current) => {
        const localPending = current.filter((entry) => {
          const key = entry.serverId || entry.id || entry.localId;
          const hasServerIdentity = Boolean(entry.serverId || isUuid(entry.id));
          return !hasServerIdentity && !completedKeys.has(key);
        });
        return [...completed, ...localPending].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
      });

      if (activeRow && !activeRef.current) {
        const serverShift = shiftFromSupabase(activeRow);
        activeRef.current = serverShift;
        setActiveShift(serverShift);
      }
    } catch (_error) {
      // Local clocking still works if time_entries is unavailable.
    }
  }, [user?.id]);

  useEffect(() => {
    refreshServerEntries();
  }, [refreshServerEntries]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const interval = setInterval(refreshServerEntries, 45_000);
    return () => clearInterval(interval);
  }, [refreshServerEntries, user?.id]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshServerEntries();
    });
    return () => subscription.remove();
  }, [refreshServerEntries, user?.id]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const interval = setInterval(() => {
      flushQueuedWrites();
    }, 60_000);
    return () => clearInterval(interval);
  }, [user?.id]);

  useEffect(() => {
    writeStore({
      activeShift,
      entries,
      knownProjects: resolvedProjects || [],
      lastNotice: trackingNotice,
      lastNotificationAt: notificationRef.current,
    });
  }, [activeShift, entries, resolvedProjects, trackingNotice]);

  useEffect(() => {
    if (!activeShift) return undefined;
    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeShift]);

  useEffect(() => {
    let cancelled = false;

    async function syncBackgroundTrackingState() {
      if (!activeShift) {
        await stopBackgroundTracking();
        return;
      }

      const permissions = await requestPermissions();
      if (cancelled) return;

      if (!permissions.foreground) {
        setTrackingNotice({
          type: "permission",
          message: "Location permission is required while clocked in.",
          createdAt: new Date().toISOString(),
        });
        return;
      }

      if (!permissions.background) {
        setTrackingNotice({
          type: "permission",
          message: "Enable background location so Ottawa Painters can keep tracking while the app is closed.",
          createdAt: new Date().toISOString(),
        });
        return;
      }

      const started = await startBackgroundTracking();
      if (!cancelled && !started) {
        setTrackingNotice({
          type: "permission",
          message: "Background location could not start. Reopen the app or check location settings.",
          createdAt: new Date().toISOString(),
        });
      }
    }

    syncBackgroundTrackingState();

    return () => {
      cancelled = true;
    };
  }, [activeShift?.localId, activeShift?.serverId]);

  const applyLocation = useCallback(async (location) => {
    const shift = activeRef.current;
    const point = toPoint(location);
    if (!shift || !point) return;

    const status = await enrichLocationStatus(createLocationStatus(shift, projectsRef.current, point));
    const nextShift = appendSegment(
      {
        ...shift,
        lastLocation: point,
        lastLocationLabel: status.locationLabel || shift.lastLocationLabel || null,
        lastDistanceMeters: status.activeDistance,
        onSite: status.onSite,
        travelStartedAt: status.onSite === false && !shift.travelStartedAt ? new Date().toISOString() : shift.travelStartedAt,
      },
      status,
    );

    activeRef.current = nextShift;
    setActiveShift(nextShift);
    setLocationStatus(status);
    setSuggestedProject(status.suggestedProject);
    setTrackingNotice(
      status.suggestedProject
        ? {
            type: "switch_project",
            message: status.locationLabel
              ? `Looks like you may be at ${status.suggestedProject.name} near ${status.locationLabel}.`
              : `Looks like you may be at ${status.suggestedProject.name}.`,
            suggestedProject: status.suggestedProject,
            createdAt: new Date().toISOString(),
          }
        : status.shouldPromptClockOut
          ? {
              type: "clock_out",
              message: status.locationLabel
                ? `You are ${formatDistance(status.activeDistance)} from ${shift.project?.name || "this job"} near ${status.locationLabel}. Clock out if you are done.`
                : `You are ${formatDistance(status.activeDistance)} from ${shift.project?.name || "this job"}. Clock out if you are done.`,
              createdAt: new Date().toISOString(),
            }
          : { type: "status", message: status.label, createdAt: new Date().toISOString() },
    );

    const store = await readStore();
    const didNotify = await notifyIfNeeded(store, status, nextShift);
    if (didNotify) notificationRef.current = Date.now();
    await updateActiveLocation(nextShift);
  }, []);

  useEffect(() => {
    if (!activeShift) return undefined;
    let watcher;
    let cancelled = false;

    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 30000 },
      applyLocation,
    )
      .then((subscription) => {
        if (cancelled) subscription.remove();
        else watcher = subscription;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (watcher) watcher.remove();
    };
  }, [activeShift?.localId, applyLocation]);

  const clockIn = useCallback(
    async (project) => {
      const normalizedProject = await geocodeProject(project);
      if (!normalizedProject) return null;

      const permissions = await requestPermissions();
      const point = permissions.foreground ? await getCurrentPoint() : null;
      let shift = createShift(normalizedProject, user, point);

      if (point) {
        const status = await enrichLocationStatus(createLocationStatus(shift, projectsRef.current, point));
        shift = appendSegment(
          {
            ...shift,
            lastLocationLabel: status.locationLabel || null,
            lastDistanceMeters: status.activeDistance,
            onSite: status.onSite,
          },
          status,
        );
        setLocationStatus(status);
      }

      activeRef.current = shift;
      setActiveShift(shift);
      setTrackingNotice(null);
      setSuggestedProject(null);

      insertActiveEntry(shift).then((serverId) => {
        if (!serverId) return;
        setActiveShift((current) => {
          if (!current || current.localId !== shift.localId) return current;
          const next = { ...current, serverId };
          activeRef.current = next;
          return next;
        });
      });

      if (permissions.background) await startBackgroundTracking();
      return shift;
    },
    [user],
  );

  const clockOut = useCallback(async (reason = "manual") => {
    const shift = activeRef.current;
    if (!shift) return null;

    const entry = shiftToEntry(shift, new Date().toISOString(), reason);
    setEntries((current) => [entry, ...current.filter((item) => item.localId !== entry.localId)]);
    setTeamEntries((current) => [entry, ...current.filter((item) => (item.serverId || item.localId) !== (entry.serverId || entry.localId))]);
    setActiveShift(null);
    activeRef.current = null;
    setLocationStatus(null);
    setTrackingNotice(null);
    setSuggestedProject(null);
    await completeEntry(entry);
    await stopBackgroundTracking();
    return entry;
  }, []);

  const switchProject = useCallback(
    async (project) => {
      const current = activeRef.current;
      if (!current) return clockIn(project);

      const completed = shiftToEntry(current, new Date().toISOString(), "switched_project");
      setEntries((entriesNow) => [completed, ...entriesNow.filter((item) => item.localId !== completed.localId)]);
      setTeamEntries((entriesNow) => [completed, ...entriesNow.filter((item) => (item.serverId || item.localId) !== (completed.serverId || completed.localId))]);
      await completeEntry(completed);

      const nextProject = await geocodeProject(project);
      let next = createShift(nextProject, user, current.lastLocation);
      next = { ...next, travelStartedAt: current.travelStartedAt };
      activeRef.current = next;
      setActiveShift(next);
      setTrackingNotice(null);
      setSuggestedProject(null);
      insertActiveEntry(next).then((serverId) => {
        if (!serverId) return;
        setActiveShift((activeNow) => {
          if (!activeNow || activeNow.localId !== next.localId) return activeNow;
          const updated = { ...activeNow, serverId };
          activeRef.current = updated;
          return updated;
        });
      });
      return next;
    },
    [clockIn, user],
  );

  const deleteTimeEntry = useCallback(async (entry) => {
    const targetKey = entry?.serverId || entry?.id || entry?.localId;
    if (!targetKey) return false;

    const activeKey = activeRef.current?.serverId || activeRef.current?.localId;
    if (activeKey && activeKey === targetKey) {
      setActiveShift(null);
      activeRef.current = null;
      setLocationStatus(null);
      setTrackingNotice(null);
      setSuggestedProject(null);
      await stopBackgroundTracking();
    }

    setEntries((current) =>
      current.filter((item) => (item.serverId || item.id || item.localId) !== targetKey),
    );
    setTeamEntries((current) =>
      current.filter((item) => (item.serverId || item.id || item.localId) !== targetKey),
    );

    await deleteServerEntry(entry);
    return true;
  }, []);

  const updateTimeEntry = useCallback(async (entry, updates) => {
    const targetKey = entry?.serverId || entry?.id || entry?.localId;
    if (!targetKey) return null;

    const updated = applyEntryTimeUpdate(entry, updates);
    const activeKey = activeRef.current?.serverId || activeRef.current?.localId;

    if (activeKey && activeKey === targetKey) {
      activeRef.current = updated;
      setActiveShift(updated);
    }

    setEntries((current) =>
      current.map((item) =>
        (item.serverId || item.id || item.localId) === targetKey ? updated : item,
      ),
    );
    setTeamEntries((current) =>
      current.map((item) =>
        (item.serverId || item.id || item.localId) === targetKey ? updated : item,
      ),
    );

    await persistUpdatedEntry(updated);
    return updated;
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
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

    return () => subscription.remove();
  }, [clockOut, switchProject]);

  const activeElapsedMs = activeShift ? Math.max(0, tick - new Date(activeShift.startedAt).getTime()) : 0;
  const liveEntries = useMemo(() => {
    const active = activeEntry(activeShift);
    return active ? [active, ...entries] : entries;
  }, [activeShift, entries, tick]);
  const liveTeamEntries = useMemo(() => {
    const active = activeEntry(activeShift);
    const merged = active ? [active, ...teamEntries] : teamEntries;
    const seen = new Set();
    return merged.filter((entry) => {
      const key = entry.serverId || entry.id || entry.localId;
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [activeShift, teamEntries, tick]);
  const projectTimeTotals = useMemo(() => getProjectTimeTotals(entries, activeShift), [entries, activeShift, tick]);

  return {
    activeShift,
    activeElapsedMs,
    entries,
    liveEntries,
    teamEntries,
    liveTeamEntries,
    locationStatus,
    trackingNotice,
    suggestedProject,
    resolvedProjects,
    projectTimeTotals,
    refreshServerEntries,
    clockIn,
    clockOut,
    switchProject,
    deleteTimeEntry,
    updateTimeEntry,
  };
}
