import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { formatDistance, normalizeProject } from "./trackingModel";
import { activeEntry, applyEntryTimeUpdate, entryIdentityKeys, shiftToEntry } from "./timeEntryModel";
import { getProjectTimeTotals } from "./timeEntryPresenters";
import {
  consumeInitialNotificationResponse,
  notifyIfNeeded,
  subscribeToTrackingNotificationResponses,
} from "./timeTrackingNotifications";
import { syncGeofences } from "./timeTrackingGeofence";
import {
  appendSegment,
  createLocationStatus,
  geocodeProject,
  geocodeProjects,
  toPoint,
} from "./timeTrackingLocation";
import {
  getCurrentPoint,
  getTrackingPermissions,
  requestTrackingPermissions,
  startBackgroundTracking,
  stopBackgroundTracking,
  watchActiveLocation,
} from "./timeTrackingRuntime";
import {
  completeEntry,
  deleteServerEntry,
  entryFromSupabase,
  fetchTimeEntryRows,
  flushQueuedWrites,
  insertActiveEntry,
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

export { BACKGROUND_LOCATION_TASK } from "./timeTrackingRuntime";

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
    originalStartedAt: now,
    startedAt: now,
    startEditedAt: null,
    startedLocation: point,
    lastLocation: point,
    lastLocationLabel: null,
    lastDistanceMeters: null,
    onSite: null,
    travelStartedAt: null,
    segments: [],
    adjustmentHistory: [],
  };
}

function buildPermissionNotice(permissions, fallbackMessage) {
  if (!permissions?.foreground) {
    return {
      type: "permission",
      message: fallbackMessage || "Location access is required before clocking in.",
      createdAt: new Date().toISOString(),
    };
  }

  if (!permissions?.background) {
    return {
      type: "permission",
      message:
        fallbackMessage ||
        "Background location must be set to Always before clocking in.",
      createdAt: new Date().toISOString(),
    };
  }

  return {
    type: "permission",
    message: fallbackMessage || "Location tracking is not ready. Check location settings and try again.",
    createdAt: new Date().toISOString(),
  };
}

// In development (Expo Go) the "Always" background permission cannot be granted,
// so we let foreground-only access be enough to clock in. Production still
// requires full background tracking (permissions.ready).
function permissionsAllowTracking(permissions) {
  return Boolean(permissions?.ready || (__DEV__ && permissions?.foreground));
}

function hasSeenEntry(seen, entry) {
  const keys = entryIdentityKeys(entry);
  if (!keys.length) return false;
  return keys.some((key) => seen.has(key));
}

function markEntrySeen(seen, entry) {
  for (const key of entryIdentityKeys(entry)) {
    seen.add(key);
  }
}

function isSameEntry(a, b) {
  const aKeys = new Set(entryIdentityKeys(a));
  if (!aKeys.size) return false;
  return entryIdentityKeys(b).some((key) => aKeys.has(key));
}

export function useTimeTracking(projects = [], user) {
  const [activeShift, setActiveShift] = useState(null);
  const [entries, setEntries] = useState([]);
  const [teamEntries, setTeamEntries] = useState([]);
  const [resolvedProjects, setResolvedProjects] = useState(projects || []);
  const [locationStatus, setLocationStatus] = useState(null);
  const [trackingNotice, setTrackingNotice] = useState(null);
  const [trackingPermissions, setTrackingPermissions] = useState(null);
  const [suggestedProject, setSuggestedProject] = useState(null);
  const [tick, setTick] = useState(Date.now());
  const [hydrated, setHydrated] = useState(false);

  const activeRef = useRef(null);
  const projectsRef = useRef(projects);
  const notificationRef = useRef(0);
  const entriesRef = useRef([]);

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
    entriesRef.current = entries;
  }, [entries]);

  const refreshTrackingPermissions = useCallback(async ({ request = false } = {}) => {
    const permissions = request ? await requestTrackingPermissions() : await getTrackingPermissions();
    setTrackingPermissions(permissions);
    if (permissions.ready) {
      setTrackingNotice((current) => (current?.type === "permission" ? null : current));
    }
    return permissions;
  }, []);

  const requestTrackingPermissionAccess = useCallback(
    () => refreshTrackingPermissions({ request: true }),
    [refreshTrackingPermissions],
  );

  useEffect(() => {
    refreshTrackingPermissions();
  }, [refreshTrackingPermissions]);

  useEffect(() => {
    let mounted = true;
    readStore()
      .then((store) => {
        if (!mounted) return;
        setActiveShift(store.activeShift || null);
        setEntries(Array.isArray(store.entries) ? store.entries : []);
        setTrackingNotice(store.lastNotice || null);
        setSuggestedProject(store.lastNotice?.suggestedProject || null);
        notificationRef.current = Number(store.lastNotificationAt || 0);
      })
      .catch(() => {})
      .finally(() => {
        // Mark hydration complete so the persistence effect can start writing.
        // Even on failure we allow writes so new activity is not blocked.
        if (mounted) setHydrated(true);
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
      const completedKeys = new Set(completed.flatMap(entryIdentityKeys));

      setTeamEntries(rows.map(entryFromSupabase));
      setEntries((current) => {
        // Keep local entries whose identity keys are not represented in the
        // server result (e.g. a local clock-out whose completion write is still
        // queued). Server-completed rows replace their local counterparts.
        const localPending = current.filter(
          (entry) => !entryIdentityKeys(entry).some((key) => completedKeys.has(key)),
        );
        return [...completed, ...localPending].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
      });

      if (activeRow && !activeRef.current) {
        const serverShift = shiftFromSupabase(activeRow);
        const serverKeys = new Set(entryIdentityKeys(serverShift));
        // Do not resurrect a server "active" row that the user already clocked
        // out locally (its local entry shares identity keys with the row).
        const alreadyLocal = (entriesRef.current || []).some((entry) =>
          entryIdentityKeys(entry).some((key) => serverKeys.has(key)),
        );
        if (!alreadyLocal) {
          activeRef.current = serverShift;
          setActiveShift(serverShift);
        }
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
    const subscription = AppState.addEventListener("change", async (state) => {
      if (state !== "active") return;

      // While backgrounded, the background location task owns read-modify-write
      // of the persisted store. On return to foreground, re-read it and merge
      // those fields into React state BEFORE any subsequent persistence write,
      // otherwise stale foreground state would clobber the background updates.
      try {
        const store = await readStore();
        notificationRef.current = Math.max(
          Number(store.lastNotificationAt || 0),
          notificationRef.current,
        );
        const current = activeRef.current;
        if (store.activeShift && current && store.activeShift.localId === current.localId) {
          const merged = {
            ...current,
            segments:
              Array.isArray(store.activeShift.segments) && store.activeShift.segments.length
                ? store.activeShift.segments
                : current.segments,
            lastLocation: store.activeShift.lastLocation || current.lastLocation,
            lastDistanceMeters: store.activeShift.lastDistanceMeters ?? current.lastDistanceMeters,
            onSite: store.activeShift.onSite ?? current.onSite,
            travelStartedAt: store.activeShift.travelStartedAt || current.travelStartedAt,
          };
          activeRef.current = merged;
          setActiveShift(merged);
        }
      } catch (_error) {
        // Non-fatal; fall back to the server refresh below.
      }

      refreshServerEntries();
      refreshTrackingPermissions();
    });
    return () => subscription.remove();
  }, [refreshServerEntries, refreshTrackingPermissions, user?.id]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const interval = setInterval(() => {
      flushQueuedWrites();
    }, 60_000);
    return () => clearInterval(interval);
  }, [user?.id]);

  useEffect(() => {
    // Do not persist until hydration has completed, otherwise the initial empty
    // state would overwrite a persisted in-progress shift.
    if (!hydrated) return;
    writeStore({
      activeShift,
      entries,
      knownProjects: resolvedProjects || [],
      lastNotice: trackingNotice,
      lastNotificationAt: notificationRef.current,
    });
  }, [hydrated, activeShift, entries, resolvedProjects, trackingNotice]);

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

      const permissions = await requestTrackingPermissions();
      if (cancelled) return;
      setTrackingPermissions(permissions);

      if (!permissionsAllowTracking(permissions)) {
        setTrackingNotice(buildPermissionNotice(permissions));
        return;
      }

      // Expo Go can't start Always background tracking; the foreground watcher
      // above keeps the active shift updated during development.
      if (__DEV__ && !permissions.ready) return;

      const started = await startBackgroundTracking();
      if (!cancelled && !started) {
        setTrackingNotice({
          type: "permission",
          message: "Background location could not start. Reopen the app or check location settings.",
          createdAt: new Date().toISOString(),
        });
        return;
      }

      if (!cancelled) {
        setTrackingNotice((current) => (current?.type === "permission" ? null : current));
      }
    }

    syncBackgroundTrackingState();

    return () => {
      cancelled = true;
    };
  }, [activeShift?.localId, activeShift?.serverId]);

  useEffect(() => {
    // Register job-site geofences so the painter is prompted to clock in on
    // arrival, even while clocked out and with the app closed. Requires
    // background ("Always") location; syncGeofences no-ops otherwise. Geofences
    // intentionally persist across unmount/app-close, so there is no teardown.
    if (!permissionsAllowTracking(trackingPermissions)) return undefined;
    syncGeofences(resolvedProjects);
    return undefined;
  }, [
    resolvedProjects,
    trackingPermissions?.ready,
    trackingPermissions?.foreground,
    trackingPermissions?.background,
  ]);

  const applyLocation = useCallback(async (location) => {
    const shift = activeRef.current;
    const point = toPoint(location);
    if (!shift || !point) return;

    const status = createLocationStatus(shift, projectsRef.current, point);
    const nextShift = appendSegment(
      {
        ...shift,
        lastLocation: point,
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
            message: `Looks like you may be at ${status.suggestedProject.name}.`,
            suggestedProject: status.suggestedProject,
            createdAt: new Date().toISOString(),
          }
        : status.shouldPromptClockOut
          ? {
              type: "clock_out",
              message: `You are ${formatDistance(status.activeDistance)} from ${shift.project?.name || "this job"}. Clock out if you are done.`,
              createdAt: new Date().toISOString(),
            }
          : { type: "status", message: status.label, createdAt: new Date().toISOString() },
    );

    const store = await readStore();
    const didNotify = await notifyIfNeeded(store, status, nextShift);
    if (didNotify) notificationRef.current = Date.now();

    // If the shift has no serverId, the network write targets by client_entry_id
    // and could resurrect a shift the user has since clocked out. Bail if the
    // active shift no longer matches.
    if (!nextShift.serverId && activeRef.current?.localId !== nextShift.localId) return;
    await updateActiveLocation(nextShift);
  }, []);

  useEffect(() => {
    if (!activeShift || !permissionsAllowTracking(trackingPermissions)) return undefined;
    let watcher;
    let cancelled = false;

    watchActiveLocation(applyLocation)
      .then((subscription) => {
        if (cancelled) subscription.remove();
        else watcher = subscription;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (watcher) watcher.remove();
    };
  }, [activeShift?.localId, applyLocation, trackingPermissions?.ready, trackingPermissions?.foreground]);

  const clockIn = useCallback(
    async (project) => {
      const baseProject = normalizeProject(project);
      if (!baseProject) return null;

      const permissions = await requestTrackingPermissions();
      setTrackingPermissions(permissions);
      if (!permissionsAllowTracking(permissions)) {
        setTrackingNotice(buildPermissionNotice(permissions));
        return null;
      }

      const backgroundStarted = await startBackgroundTracking();
      if (!backgroundStarted && !__DEV__) {
        setTrackingNotice(
          buildPermissionNotice(permissions, "Background location could not start. Open Settings and confirm Location is set to Always."),
        );
        return null;
      }

      const shift = createShift(baseProject, user, null);
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

      Promise.resolve()
        .then(async () => {
          const [normalizedProject, point] = await Promise.all([
            geocodeProject(project),
            getCurrentPoint(),
          ]);
          const current = activeRef.current;
          if (!current || current.localId !== shift.localId) return;

          let nextShift = {
            ...current,
            project: normalizedProject || current.project,
            startedLocation: current.startedLocation || point,
            lastLocation: point || current.lastLocation,
          };

          if (point) {
            const status = createLocationStatus(nextShift, projectsRef.current, point);
            nextShift = appendSegment(
              {
                ...nextShift,
                lastDistanceMeters: status.activeDistance,
                onSite: status.onSite,
              },
              status,
            );
            setLocationStatus(status);
          }

          activeRef.current = nextShift;
          setActiveShift(nextShift);
          if (!nextShift.serverId && activeRef.current?.localId !== nextShift.localId) return;
          await updateActiveLocation(nextShift);
        })
        .catch(() => {});

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

      const permissions = await getTrackingPermissions();
      setTrackingPermissions(permissions);
      if (!permissionsAllowTracking(permissions)) {
        setTrackingNotice(buildPermissionNotice(permissions));
        return null;
      }

      // Resolve the next project first so we can bail (like clockIn) without
      // leaving the user clocked out of the current job with nothing active.
      const nextProject = await geocodeProject(project);
      if (!nextProject) {
        setTrackingNotice(buildPermissionNotice(permissions, "Could not resolve the selected project."));
        return null;
      }

      const completed = shiftToEntry(current, new Date().toISOString(), "switched_project");
      setEntries((entriesNow) => [completed, ...entriesNow.filter((item) => !isSameEntry(item, completed))]);
      setTeamEntries((entriesNow) => [completed, ...entriesNow.filter((item) => !isSameEntry(item, completed))]);
      await completeEntry(completed);

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
    if (!entryIdentityKeys(entry).length) return false;

    if (isSameEntry(activeRef.current, entry)) {
      setActiveShift(null);
      activeRef.current = null;
      setLocationStatus(null);
      setTrackingNotice(null);
      setSuggestedProject(null);
      await stopBackgroundTracking();
    }

    setEntries((current) =>
      current.filter((item) => !isSameEntry(item, entry)),
    );
    setTeamEntries((current) =>
      current.filter((item) => !isSameEntry(item, entry)),
    );

    await deleteServerEntry(entry);
    return true;
  }, []);

  const updateTimeEntry = useCallback(async (entry, updates) => {
    if (!entryIdentityKeys(entry).length) return null;

    const updated = applyEntryTimeUpdate(entry, {
      ...updates,
      adjustedBy: compactUser(user),
    });

    if (isSameEntry(activeRef.current, entry)) {
      activeRef.current = updated;
      setActiveShift(updated);
    }

    setEntries((current) =>
      current.map((item) =>
        isSameEntry(item, entry) ? updated : item,
      ),
    );
    setTeamEntries((current) =>
      current.map((item) =>
        isSameEntry(item, entry) ? updated : item,
      ),
    );

    await persistUpdatedEntry(updated);
    return updated;
  }, [user]);

  useEffect(() => {
    // An arrival prompt fires only while clocked out, but the user may have
    // clocked in elsewhere before tapping it: treat a tap for a different job
    // as a switch, and ignore it if they are already on that job.
    const clockInFromNotification = (project) => {
      const current = activeRef.current;
      const normalized = normalizeProject(project);
      if (!normalized) return Promise.resolve(null);
      if (current) {
        if (current.project?.companycam_id === normalized.companycam_id) {
          return Promise.resolve(current);
        }
        return switchProject(normalized);
      }
      return clockIn(normalized);
    };

    const handlers = {
      clockIn: clockInFromNotification,
      clockOut,
      switchProject,
      setSuggestedProject,
      setTrackingNotice,
    };

    const subscription = subscribeToTrackingNotificationResponses(handlers);
    // Handle a notification tapped to cold-launch the app.
    consumeInitialNotificationResponse(handlers);

    return () => subscription.remove();
  }, [clockIn, clockOut, switchProject]);

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
      if (hasSeenEntry(seen, entry)) return false;
      markEntrySeen(seen, entry);
      return true;
    });
  }, [activeShift, teamEntries, tick]);
  const projectTimeTotals = useMemo(() => getProjectTimeTotals(liveTeamEntries, null), [liveTeamEntries, tick]);
  const todayWorkedMs = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return liveEntries.reduce((sum, entry) => {
      const startedMs = new Date(entry.startedAt).getTime();
      if (!Number.isFinite(startedMs) || startedMs < startOfDay) return sum;
      return sum + (entry.durationMs || 0);
    }, 0);
  }, [liveEntries, tick]);

  return {
    activeShift,
    activeElapsedMs,
    todayWorkedMs,
    entries,
    liveEntries,
    teamEntries,
    liveTeamEntries,
    locationStatus,
    trackingNotice,
    trackingPermissions,
    suggestedProject,
    resolvedProjects,
    projectTimeTotals,
    refreshServerEntries,
    refreshTrackingPermissions,
    requestTrackingPermissionAccess,
    clockIn,
    clockOut,
    switchProject,
    deleteTimeEntry,
    updateTimeEntry,
  };
}
