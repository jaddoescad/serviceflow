import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { normalizeProject } from "./trackingModel";
import { activeEntry, applyEntryTimeUpdate, entryIdentityKeys, shiftToEntry } from "./timeEntryModel";
import { getProjectLatestActivity, getProjectTimeTotals } from "./timeEntryPresenters";
import {
  cancelActiveShiftReminders,
  consumeInitialNotificationResponse,
  ensureActiveShiftReminders,
  subscribeToTrackingNotificationResponses,
} from "./timeTrackingNotifications";
import { retireLegacyGeofences } from "./timeTrackingGeofence";
import {
  geocodeProject,
  geocodeProjects,
} from "./timeTrackingLocation";
import {
  configureAdaptiveTracking,
  finishTrackingSession,
  getCurrentPoint,
  getTrackingPermissions,
  recordShiftLocation,
  reportTrackingIssue,
  requestTrackingPermissions,
  stopBackgroundTracking,
  watchActiveLocation,
} from "./timeTrackingRuntime";
import { syncPendingLocationData } from "./locationTrackingRepository";
import { flushPendingProjectLabourTaskWrites } from "./projectLabourTasks";
import {
  completeEntry,
  deleteServerEntry,
  entryFromSupabase,
  fetchTimeEntryRows,
  flushQueuedWrites,
  insertActiveEntry,
  persistUpdatedEntry,
  shiftFromSupabase,
  switchEntry,
  updateActiveLocation,
} from "./timeEntryRepository";
import {
  closeStoredShift,
  persistCompletedEntry,
  persistStoreFields,
  readStore,
  readTrackingRuntimeState,
  startStoredShift,
  switchStoredShift,
  updateStoredActiveShift,
} from "./timeTrackingStorage";

export { distanceMeters, formatAddress, formatDistance, formatDuration, normalizeProject } from "./trackingModel";
export { buildProjectClockInDays, buildTimesheetDays, getProjectTimeTotals } from "./timeEntryPresenters";

export { BACKGROUND_LOCATION_TASK } from "./timeTrackingRuntime";

const FOREGROUND_LOCATION_HEARTBEAT_MS = 4 * 60 * 1000;
const CLOCK_OUT_LOCATION_TIMEOUT_MS = 8 * 1000;

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

  return {
    type: "permission",
    message: fallbackMessage || "Location tracking is not ready. Check location settings and try again.",
    createdAt: new Date().toISOString(),
  };
}

function permissionsAllowTracking(permissions) {
  return Boolean(permissions?.foreground);
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
  const [trackingDiagnostic, setTrackingDiagnostic] = useState(null);
  const [suggestedProject, setSuggestedProject] = useState(null);
  const [tick, setTick] = useState(Date.now());
  const [hydrated, setHydrated] = useState(false);

  const activeRef = useRef(null);
  const projectsRef = useRef(projects);
  const notificationRef = useRef(0);
  const entriesRef = useRef([]);
  const trackingPermissionsRef = useRef(null);
  const foregroundLocationMutationRef = useRef(Promise.resolve());
  const clockOutInProgressRef = useRef(false);

  const applyForegroundPoint = useCallback((point) => {
    if (!point || clockOutInProgressRef.current) return Promise.resolve(null);
    const next = foregroundLocationMutationRef.current
      .catch(() => {})
      .then(async () => {
        const shift = activeRef.current;
        if (!shift || clockOutInProgressRef.current) return null;
        const recorded = await recordShiftLocation(
          shift,
          projectsRef.current,
          point,
          { permissions: trackingPermissionsRef.current },
        );
        if (recorded.stale || !recorded.status) return null;

        const current = activeRef.current;
        if (!current || current.localId !== shift.localId || clockOutInProgressRef.current) {
          return null;
        }
        const nextShift = {
          ...recorded.shift,
          serverId: current.serverId || recorded.shift.serverId,
        };
        const transition = await updateStoredActiveShift(current, nextShift);
        if (!transition.applied) {
          const stored = transition.store?.activeShift;
          if (stored?.localId === current.localId) {
            activeRef.current = stored;
            setActiveShift(stored);
          }
          return null;
        }

        activeRef.current = nextShift;
        setActiveShift(nextShift);
        setLocationStatus(recorded.status);
        setSuggestedProject(recorded.status.suggestedProject || null);
        setTrackingNotice((notice) => notice?.type === "tracking_error" ? null : notice);
        setTrackingDiagnostic(await readTrackingRuntimeState());
        return nextShift;
      });
    foregroundLocationMutationRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, []);

  const recordForegroundTrackingIssue = useCallback(async (errorCode) => {
    const shift = activeRef.current;
    if (!shift || clockOutInProgressRef.current) return;
    await reportTrackingIssue(shift, errorCode, trackingPermissionsRef.current);
    if (activeRef.current?.localId !== shift.localId) return;
    setTrackingNotice({
      type: "tracking_error",
      message: "Location could not be refreshed. ServiceFlow will keep trying while you are clocked in.",
      createdAt: new Date().toISOString(),
    });
    setTrackingDiagnostic(await readTrackingRuntimeState());
  }, []);

  const captureForegroundPoint = useCallback(async () => {
    const expectedShift = activeRef.current;
    if (!expectedShift || clockOutInProgressRef.current) return null;
    const point = await getCurrentPoint();
    if (activeRef.current?.localId !== expectedShift.localId || clockOutInProgressRef.current) {
      return null;
    }
    if (!point) {
      await recordForegroundTrackingIssue("foreground_location_unavailable");
      return null;
    }
    await applyForegroundPoint(point);
    return point;
  }, [applyForegroundPoint, recordForegroundTrackingIssue]);

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
    trackingPermissionsRef.current = trackingPermissions;
  }, [trackingPermissions]);

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
    // Retire regions registered by releases that used elevated location access.
    // New releases never create geofences.
    retireLegacyGeofences().catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([readStore(), readTrackingRuntimeState()])
      .then(([store, runtime]) => {
        if (!mounted) return;
        setActiveShift(store.activeShift || null);
        setEntries(Array.isArray(store.entries) ? store.entries : []);
        setTrackingNotice(store.lastNotice || null);
        setSuggestedProject(store.lastNotice?.suggestedProject || null);
        notificationRef.current = Number(store.lastNotificationAt || 0);
        setTrackingDiagnostic(runtime || null);
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

      const localActive = activeRef.current;
      const completedActive = localActive
        ? completed.find((entry) => isSameEntry(entry, localActive))
        : null;
      if (localActive && completedActive) {
        // Server completion is authoritative. A stale local snapshot must be
        // cleared, never clocked out a second time with a newer end timestamp.
        await closeStoredShift(localActive, completedActive);
        activeRef.current = null;
        setActiveShift(null);
        setLocationStatus(null);
        await stopBackgroundTracking();
      }

      if (activeRow && !activeRef.current) {
        const serverShift = shiftFromSupabase(activeRow);
        const serverKeys = new Set(entryIdentityKeys(serverShift));
        // Do not resurrect a server "active" row that the user already clocked
        // out locally (its local entry shares identity keys with the row).
        const alreadyLocal = (entriesRef.current || []).some((entry) =>
          entryIdentityKeys(entry).some((key) => serverKeys.has(key)),
        );
        if (!alreadyLocal) {
          const transition = await startStoredShift(serverShift);
          if (transition.applied) {
            activeRef.current = serverShift;
            setActiveShift(serverShift);
          }
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
        const [store, runtime] = await Promise.all([readStore(), readTrackingRuntimeState()]);
        setTrackingDiagnostic(runtime || null);
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
      captureForegroundPoint();
    });
    return () => subscription.remove();
  }, [captureForegroundPoint, refreshServerEntries, refreshTrackingPermissions, user?.id]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const interval = setInterval(() => {
      flushQueuedWrites();
      flushPendingProjectLabourTaskWrites();
      syncPendingLocationData();
    }, 60_000);
    return () => clearInterval(interval);
  }, [user?.id]);

  useEffect(() => {
    // Do not persist until hydration has completed, otherwise the initial empty
    // state would overwrite a persisted in-progress shift.
    if (!hydrated) return;
    persistStoreFields({
      entries,
      knownProjects: resolvedProjects || [],
      lastNotice: trackingNotice,
      lastNotificationAt: notificationRef.current,
    });
  }, [hydrated, entries, resolvedProjects, trackingNotice]);

  useEffect(() => {
    if (!hydrated) return;
    if (activeShift?.localId) {
      ensureActiveShiftReminders(activeShift);
    } else {
      cancelActiveShiftReminders();
    }
  }, [activeShift?.localId, hydrated]);

  useEffect(() => {
    if (!activeShift) return undefined;
    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeShift]);

  useEffect(() => {
    if (!activeShift || !trackingPermissions?.foreground) return undefined;
    let cancelled = false;
    let watcher = null;

    captureForegroundPoint();
    const heartbeat = setInterval(
      captureForegroundPoint,
      FOREGROUND_LOCATION_HEARTBEAT_MS,
    );
    watchActiveLocation(
      (point) => {
        if (!cancelled) applyForegroundPoint(point);
      },
      () => {
        if (!cancelled) recordForegroundTrackingIssue("foreground_watcher_error");
      },
    )
      .then((subscription) => {
        if (cancelled) subscription.remove();
        else watcher = subscription;
      })
      .catch(() => {
        if (!cancelled) recordForegroundTrackingIssue("foreground_watcher_start_failed");
      });

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      if (watcher) watcher.remove();
    };
  }, [
    activeShift?.localId,
    applyForegroundPoint,
    captureForegroundPoint,
    recordForegroundTrackingIssue,
    trackingPermissions?.foreground,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function syncBackgroundTrackingState() {
      if (!activeShift) {
        await stopBackgroundTracking();
        setTrackingDiagnostic(await readTrackingRuntimeState());
        return;
      }

      const permissions = await requestTrackingPermissions();
      if (cancelled) return;
      setTrackingPermissions(permissions);

      if (!permissionsAllowTracking(permissions)) {
        setTrackingNotice(buildPermissionNotice(permissions));
        return;
      }

      const result = await configureAdaptiveTracking(activeShift, projectsRef.current, {
        permissions,
      });
      if (!cancelled && !result.started) {
        setTrackingNotice({
          type: "tracking_error",
          message: "Active-shift tracking could not start. Keep ServiceFlow open or check location settings.",
          createdAt: new Date().toISOString(),
        });
        return;
      }

      if (!cancelled) {
        setTrackingNotice((current) => (current?.type === "permission" ? null : current));
        setTrackingDiagnostic(await readTrackingRuntimeState());
      }
    }

    syncBackgroundTrackingState();

    return () => {
      cancelled = true;
    };
  }, [activeShift?.localId, activeShift?.serverId, activeShift?.onSite]);

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

      const shift = createShift(baseProject, user, null);
      const started = await startStoredShift(shift, { lastNotice: null });
      if (!started.applied) {
        if (started.store.activeShift) {
          activeRef.current = started.store.activeShift;
          setActiveShift(started.store.activeShift);
        }
        return null;
      }
      activeRef.current = shift;
      setActiveShift(shift);
      setTrackingNotice(null);
      setSuggestedProject(null);

      insertActiveEntry(shift).then(async (serverId) => {
        if (!serverId) return;
        const current = activeRef.current;
        if (!current || current.localId !== shift.localId) return;
        const next = { ...current, serverId };
        const transition = await updateStoredActiveShift(current, next);
        if (!transition.applied || activeRef.current?.localId !== shift.localId) return;
        activeRef.current = next;
        setActiveShift(next);
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
          let nextLocationStatus = null;

          if (point) {
            const recorded = await recordShiftLocation(nextShift, projectsRef.current, point, {
              eventType: "clock_in",
              permissions,
            });
            if (recorded.stale) return;
            nextShift = recorded.shift;
            nextLocationStatus = recorded.status;
          } else {
            const tracking = await configureAdaptiveTracking(nextShift, projectsRef.current, { permissions });
            if (tracking.stale) return;
            await reportTrackingIssue(nextShift, "initial_location_unavailable", permissions);
            setTrackingNotice({
              type: "tracking_error",
              message: "Your first location was not available. ServiceFlow will keep trying while you are clocked in.",
              createdAt: new Date().toISOString(),
            });
          }

          const latest = activeRef.current;
          if (!latest || latest.localId !== shift.localId) return;
          nextShift = {
            ...nextShift,
            serverId: latest.serverId || nextShift.serverId,
          };
          const transition = await updateStoredActiveShift(latest, nextShift);
          if (!transition.applied || activeRef.current?.localId !== shift.localId) return;
          activeRef.current = nextShift;
          setActiveShift(nextShift);
          if (nextLocationStatus) setLocationStatus(nextLocationStatus);
          if (!point) await updateActiveLocation(nextShift);
          setTrackingDiagnostic(await readTrackingRuntimeState());
        })
        .catch(async () => {
          const current = activeRef.current;
          if (current?.localId !== shift.localId) return;
          await reportTrackingIssue(current, "initial_location_capture_failed", permissions);
          setTrackingDiagnostic(await readTrackingRuntimeState());
        });

      return shift;
    },
    [user],
  );

  const clockOut = useCallback(async (reason = "manual") => {
    const expectedShift = activeRef.current;
    if (!expectedShift || clockOutInProgressRef.current) return null;

    clockOutInProgressRef.current = true;
    try {
      const endedAt = new Date().toISOString();
      await foregroundLocationMutationRef.current.catch(() => {});
      await stopBackgroundTracking();

      const point = await getCurrentPoint({ timeoutMs: CLOCK_OUT_LOCATION_TIMEOUT_MS });
      const store = await readStore();
      const storedShift = store.activeShift;
      if (!storedShift || storedShift.localId !== expectedShift.localId) return null;

      let shift = {
        ...storedShift,
        serverId: activeRef.current?.serverId || storedShift.serverId,
      };
      if (point) {
        const recorded = await recordShiftLocation(shift, projectsRef.current, point, {
          eventType: "clock_out",
          permissions: trackingPermissionsRef.current,
          skipTrackingReconfigure: true,
        });
        if (!recorded.stale) shift = recorded.shift;
      } else {
        await reportTrackingIssue(
          shift,
          "clock_out_location_unavailable",
          trackingPermissionsRef.current,
        );
      }

      let entry = shiftToEntry(shift, endedAt, reason);
      // The fresh location attempt finishes before this terminal transition.
      // Once the tombstone is stored, late background work cannot reopen it.
      const closed = await closeStoredShift(shift, entry, { lastNotice: null });
      if (!closed.applied) return null;
      setEntries((current) => [entry, ...current.filter((item) => item.localId !== entry.localId)]);
      setTeamEntries((current) => [entry, ...current.filter((item) => (item.serverId || item.localId) !== (entry.serverId || entry.localId))]);
      setActiveShift(null);
      activeRef.current = null;
      setLocationStatus(null);
      setTrackingNotice(null);
      setSuggestedProject(null);
      const savedRow = await completeEntry(entry);
      if (savedRow?.status === "complete" && savedRow.ended_at) {
        // A concurrent/earlier completion wins. Reflect its canonical end time
        // instead of ever extending an already-completed shift.
        entry = entryFromSupabase(savedRow);
        setEntries((current) => [entry, ...current.filter((item) => !isSameEntry(item, entry))]);
        setTeamEntries((current) => [entry, ...current.filter((item) => !isSameEntry(item, entry))]);
        await persistCompletedEntry(entry);
      }
      await finishTrackingSession(shift, projectsRef.current, {
        permissions: trackingPermissionsRef.current,
        reason,
        endedAt,
      });
      setTrackingDiagnostic(await readTrackingRuntimeState());
      return entry;
    } finally {
      clockOutInProgressRef.current = false;
    }
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

      const switchedAt = new Date().toISOString();
      let completed = shiftToEntry(current, switchedAt, "switched_project");
      let next = createShift(nextProject, user, current.lastLocation);
      next = {
        ...next,
        originalStartedAt: switchedAt,
        startedAt: switchedAt,
        travelStartedAt: current.travelStartedAt,
      };
      const switched = await switchStoredShift(current, next, completed, {
        lastNotice: null,
      });
      if (!switched.applied) return null;

      setEntries((entriesNow) => [completed, ...entriesNow.filter((item) => !isSameEntry(item, completed))]);
      setTeamEntries((entriesNow) => [completed, ...entriesNow.filter((item) => !isSameEntry(item, completed))]);
      activeRef.current = next;
      setActiveShift(next);
      setTrackingNotice(null);
      setSuggestedProject(null);

      const serverSwitch = await switchEntry(completed, next);
      if (serverSwitch?.completedRow?.status === "complete" && serverSwitch.completedRow.ended_at) {
        completed = entryFromSupabase(serverSwitch.completedRow);
        setEntries((entriesNow) => [completed, ...entriesNow.filter((item) => !isSameEntry(item, completed))]);
        setTeamEntries((entriesNow) => [completed, ...entriesNow.filter((item) => !isSameEntry(item, completed))]);
        await persistCompletedEntry(completed);
      }

      const activeRow = serverSwitch?.activeRow;
      if (
        activeRow?.status === "active" &&
        !activeRow.ended_at &&
        activeRow.client_entry_id === next.localId
      ) {
        const activeNow = activeRef.current;
        if (activeNow?.localId === next.localId) {
          const updated = { ...activeNow, serverId: activeRow.id };
          const transition = await updateStoredActiveShift(activeNow, updated);
          if (transition.applied && activeRef.current?.localId === next.localId) {
            activeRef.current = updated;
            setActiveShift(updated);
            next = updated;
          }
        }
      }

      if (current.lastLocation) {
        const latestNext = activeRef.current?.localId === next.localId ? activeRef.current : next;
        const recorded = await recordShiftLocation(latestNext, projectsRef.current, current.lastLocation, {
          eventType: "project_switch",
          permissions,
        });
        if (recorded.stale) return null;
        const activeNow = activeRef.current;
        if (!activeNow || activeNow.localId !== next.localId) return null;
        next = {
          ...recorded.shift,
          serverId: activeNow.serverId || recorded.shift.serverId,
        };
        const transition = await updateStoredActiveShift(activeNow, next);
        if (!transition.applied || activeRef.current?.localId !== next.localId) return null;
        activeRef.current = next;
        setActiveShift(next);
        setLocationStatus(recorded.status);
      } else {
        const tracking = await configureAdaptiveTracking(next, projectsRef.current, { permissions });
        if (tracking.stale) return null;
      }
      setTrackingDiagnostic(await readTrackingRuntimeState());
      return next;
    },
    [clockIn, user],
  );

  const deleteTimeEntry = useCallback(async (entry) => {
    if (!entryIdentityKeys(entry).length) return false;

    if (isSameEntry(activeRef.current, entry)) {
      await closeStoredShift(entry, null, { lastNotice: null });
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
  }, [user?.id]);

  const updateTimeEntry = useCallback(async (entry, updates) => {
    if (!entryIdentityKeys(entry).length) return null;

    let updated = applyEntryTimeUpdate(entry, {
      ...updates,
      adjustedBy: compactUser(user),
    });

    if (isSameEntry(activeRef.current, entry)) {
      const transition = await updateStoredActiveShift(entry, updated);
      if (!transition.applied) return null;
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

    const savedRow = await persistUpdatedEntry(updated);
    if (savedRow) {
      if (savedRow.status === "active" && !savedRow.ended_at) {
        const activeNow = activeRef.current;
        if (activeNow && isSameEntry(activeNow, updated)) {
          const serverShift = shiftFromSupabase(savedRow);
          const canonicalShift = {
            ...activeNow,
            serverId: serverShift.serverId,
            project: serverShift.project,
            originalStartedAt: serverShift.originalStartedAt,
            startedAt: serverShift.startedAt,
            startEditedAt: serverShift.startEditedAt,
            adjustmentHistory: serverShift.adjustmentHistory,
          };
          const transition = await updateStoredActiveShift(activeNow, canonicalShift);
          if (transition.applied && activeRef.current?.localId === canonicalShift.localId) {
            activeRef.current = canonicalShift;
            setActiveShift(canonicalShift);
            updated = canonicalShift;
          }
        }
      } else {
        updated = entryFromSupabase(savedRow);
        setEntries((current) => [updated, ...current.filter((item) => !isSameEntry(item, updated))]);
        setTeamEntries((current) => [updated, ...current.filter((item) => !isSameEntry(item, updated))]);
        await persistCompletedEntry(updated);
      }
    }
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
  // The signed-in user's own contribution per project (liveEntries is always
  // scoped to the current user, unlike liveTeamEntries).
  const myProjectTimeTotals = useMemo(() => getProjectTimeTotals(liveEntries, null), [liveEntries, tick]);
  const projectLatestActivity = useMemo(
    () => getProjectLatestActivity(liveTeamEntries, null),
    [liveTeamEntries],
  );
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
    trackingDiagnostic,
    suggestedProject,
    resolvedProjects,
    projectTimeTotals,
    myProjectTimeTotals,
    projectLatestActivity,
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
