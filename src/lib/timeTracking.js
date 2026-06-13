import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { formatDistance, normalizeProject } from "./trackingModel";
import { activeEntry, applyEntryTimeUpdate, shiftToEntry } from "./timeEntryModel";
import { getProjectTimeTotals } from "./timeEntryPresenters";
import {
  notifyIfNeeded,
  requestNotificationPermissions,
  subscribeToTrackingNotificationResponses,
} from "./timeTrackingNotifications";
import {
  appendSegment,
  createLocationStatus,
  enrichLocationStatus,
  geocodeProject,
  geocodeProjects,
  toPoint,
} from "./timeTrackingLocation";
import {
  completeEntry,
  deleteServerEntry,
  entryFromSupabase,
  fetchTimeEntryRows,
  flushQueuedWrites,
  insertActiveEntry,
  isUuid,
  persistUpdatedEntry,
  shiftFromSupabase,
  updateActiveLocation,
} from "./timeEntryRepository";
import {
  readStore,
  writeStore,
} from "./timeTrackingStorage";

export { distanceMeters, formatAddress, formatDistance, formatDuration, normalizeProject } from "./trackingModel";
export { buildProjectClockInDays, buildTimesheetDays, getProjectTimeTotals } from "./timeEntryPresenters";

export const BACKGROUND_LOCATION_TASK = "ottawa-painters-background-location";

function compactUser(user) {
  if (!user) return { id: null, email: null, name: "Painter" };
  const email = user.email || null;
  return {
    id: user.id || null,
    email,
    name: user.name || user.full_name || user.user_metadata?.full_name || user.user_metadata?.name || (email ? email.split("@")[0] : "Painter"),
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

async function requestPermissions() {
  const notifications = await requestNotificationPermissions();

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
      const rows = await fetchTimeEntryRows();
      if (!rows) return;

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
    const subscription = subscribeToTrackingNotificationResponses({
      clockOut,
      switchProject,
      setSuggestedProject,
      setTrackingNotice,
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
