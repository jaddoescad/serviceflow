import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  adjustProjectLabourTaskSession,
  getMyLatestTaskSession,
  listProjectLabourTasks,
  readCachedProjectLabourTasks,
  setProjectLabourTaskStatus,
  startProjectLabourTaskTimer,
  stopActiveProjectLabourTaskTimer,
  subscribeToProjectLabourTaskChanges,
  writeCachedProjectLabourTasks,
} from "./projectLabourTasks";

const REFRESH_INTERVAL_MS = 30_000;

function friendlyTaskError(error) {
  const message = String(error?.message || "");
  if (/not assigned|permission|row-level security/i.test(message)) {
    return "This job is not assigned to your account.";
  }
  if (/function.*does not exist|schema cache/i.test(message)) {
    return "Painter tasks are not available in this environment yet.";
  }
  return message || "Tasks could not sync. Your last saved list is still available.";
}

export function useProjectLabourTasks(projectId, { enabled = true, userId = null } = {}) {
  const normalizedProjectId = String(projectId || "");
  const [plan, setPlan] = useState({ budget: null, tasks: [], fetchedAt: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syncNotice, setSyncNotice] = useState("");
  const [pendingTaskIds, setPendingTaskIds] = useState(() => new Set());
  const requestIdRef = useRef(0);
  const planRef = useRef(plan);

  const persistPlan = useCallback(
    (update) => {
      const nextPlan = typeof update === "function" ? update(planRef.current) : update;
      planRef.current = nextPlan;
      setPlan(nextPlan);
      writeCachedProjectLabourTasks(normalizedProjectId, userId, nextPlan);
      return nextPlan;
    },
    [normalizedProjectId, userId],
  );

  const refresh = useCallback(
    async ({ silent = false } = {}) => {
      if (!normalizedProjectId || !enabled) return null;
      const requestId = ++requestIdRef.current;
      if (!silent) setLoading(true);
      const result = await listProjectLabourTasks(normalizedProjectId);
      if (requestId !== requestIdRef.current) return null;
      if (result.error) {
        setError(friendlyTaskError(result.error));
      } else if (result.plan) {
        planRef.current = result.plan;
        setPlan(result.plan);
        writeCachedProjectLabourTasks(normalizedProjectId, userId, result.plan);
        setError("");
        setSyncNotice("");
      }
      // A silent realtime refresh can supersede the initial visible request.
      // Whichever request wins must clear the shared loading state.
      setLoading(false);
      return result.plan;
    },
    [enabled, normalizedProjectId, userId],
  );

  useEffect(() => {
    let cancelled = false;
    const emptyPlan = { budget: null, tasks: [], fetchedAt: 0 };
    planRef.current = emptyPlan;
    setPlan(emptyPlan);
    setLoading(Boolean(enabled && normalizedProjectId));
    setError("");
    setSyncNotice("");
    if (!normalizedProjectId) return undefined;

    (async () => {
      const cached = await readCachedProjectLabourTasks(normalizedProjectId, userId);
      if (cancelled) return;
      if (cached) {
        planRef.current = cached;
        setPlan(cached);
      }
      await refresh();
    })();
    return () => {
      cancelled = true;
      requestIdRef.current += 1;
    };
  }, [normalizedProjectId, refresh]);

  useEffect(() => {
    if (!enabled || !normalizedProjectId) return undefined;
    const interval = setInterval(() => refresh({ silent: true }), REFRESH_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh({ silent: true });
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [enabled, normalizedProjectId, refresh]);

  useEffect(() => {
    if (!enabled || !normalizedProjectId) return undefined;

    let cancelled = false;
    let refreshTimeout = null;
    const scheduleRefresh = () => {
      if (cancelled) return;
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => refresh({ silent: true }), 150);
    };

    const unsubscribe = subscribeToProjectLabourTaskChanges(normalizedProjectId, {
      onChange: scheduleRefresh,
      onStatus: (status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          scheduleRefresh();
        }
      },
    });

    return () => {
      cancelled = true;
      if (refreshTimeout) clearTimeout(refreshTimeout);
      unsubscribe();
    };
  }, [enabled, normalizedProjectId, refresh]);

  const runTaskAction = useCallback(async (taskId, work) => {
    setPendingTaskIds((current) => new Set(current).add(taskId));
    try {
      return await work();
    } finally {
      setPendingTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    }
  }, []);

  const updateStatus = useCallback(
    async (taskId, status) =>
      runTaskAction(taskId, async () => {
        const previous = planRef.current;
        persistPlan((current) => ({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === taskId ? { ...task, status } : task,
          ),
        }));
        const result = await setProjectLabourTaskStatus(taskId, status, { userId });
        if (result.queued) {
          setSyncNotice("Saved on this device. It will sync when ServiceFlow reconnects.");
        } else if (result.error) {
          persistPlan(previous);
          setError(friendlyTaskError(result.error));
        } else {
          setError("");
        }
        return result;
      }),
    [persistPlan, runTaskAction, userId],
  );

  const startTimer = useCallback(
    async (taskId, activeShift) =>
      runTaskAction(taskId, async () => {
        if (!userId) return { error: new Error("A signed-in painter is required.") };
        const startedAt = new Date().toISOString();
        const startedAtMs = new Date(startedAt).getTime();
        const previous = planRef.current;
        persistPlan((current) => ({
          ...current,
          fetchedAt: startedAtMs,
          tasks: current.tasks.map((task) => ({
            ...task,
            hoursSpent:
              task.hoursSpent +
              (task.myActiveStartedAt
                ? Math.max(0, startedAtMs - Number(current.fetchedAt || startedAtMs)) /
                  3_600_000
                : 0),
            myActiveStartedAt: task.id === taskId ? startedAt : null,
            status:
              task.id === taskId && task.status === "pending" ? "in_progress" : task.status,
          })),
        }));

        const timerResult = await startProjectLabourTaskTimer({
          taskId,
          userId,
          timeEntryId: activeShift?.serverId || activeShift?.id || null,
          startedAt,
        });
        const statusResult =
          !timerResult.error || timerResult.queued
            ? await setProjectLabourTaskStatus(taskId, "in_progress", { userId })
            : { error: null, queued: false };
        if (timerResult.queued || statusResult.queued) {
          setSyncNotice("Timer started on this device. It will sync when ServiceFlow reconnects.");
        } else if (timerResult.error) {
          persistPlan(previous);
          setError(friendlyTaskError(timerResult.error));
        } else if (statusResult.error) {
          setError(friendlyTaskError(statusResult.error));
        } else {
          setError("");
          await refresh({ silent: true });
        }
        return timerResult;
      }),
    [persistPlan, refresh, runTaskAction, userId],
  );

  const stopTimer = useCallback(
    async (taskId) =>
      runTaskAction(taskId, async () => {
        const endedAt = new Date().toISOString();
        const endedAtMs = new Date(endedAt).getTime();
        const previous = planRef.current;
        persistPlan((current) => ({
          ...current,
          fetchedAt: endedAtMs,
          tasks: current.tasks.map((task) =>
            task.myActiveStartedAt
              ? {
                  ...task,
                  hoursSpent:
                    task.hoursSpent +
                    Math.max(0, endedAtMs - Number(current.fetchedAt || endedAtMs)) /
                      3_600_000,
                  myActiveStartedAt: null,
                }
              : task,
          ),
        }));
        const result = await stopActiveProjectLabourTaskTimer({ userId, endedAt });
        if (result.queued) {
          setSyncNotice("Timer stopped on this device. It will sync when ServiceFlow reconnects.");
        } else if (result.error) {
          persistPlan(previous);
          setError(friendlyTaskError(result.error));
        } else {
          setError("");
          await refresh({ silent: true });
        }
        return result;
      }),
    [persistPlan, refresh, runTaskAction, userId],
  );

  const fetchLastSession = useCallback(
    async (taskId) => {
      if (!userId) return { data: null, error: new Error("A signed-in painter is required.") };
      const result = await getMyLatestTaskSession(taskId, userId);
      if (result.error) result.friendlyError = friendlyTaskError(result.error);
      return result;
    },
    [userId],
  );

  const adjustSession = useCallback(
    async (taskId, session, minutes) =>
      runTaskAction(taskId, async () => {
        if (!userId || !session?.id) {
          return { error: new Error("A recorded session is required.") };
        }
        const oldMs = Math.max(
          0,
          new Date(session.ended_at).getTime() - new Date(session.started_at).getTime(),
        );
        const deltaHours = (Math.max(0, minutes) * 60_000 - oldMs) / 3_600_000;
        const previous = planRef.current;
        persistPlan((current) => ({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === taskId
              ? { ...task, hoursSpent: Math.max(0, task.hoursSpent + deltaHours) }
              : task,
          ),
        }));
        const result = await adjustProjectLabourTaskSession({
          entryId: session.id,
          userId,
          startedAt: session.started_at,
          minutes,
        });
        if (result.queued) {
          setSyncNotice("Time updated on this device. It will sync when ServiceFlow reconnects.");
        } else if (result.error) {
          persistPlan(previous);
          setError(friendlyTaskError(result.error));
        } else {
          setError("");
          await refresh({ silent: true });
        }
        return result;
      }),
    [persistPlan, refresh, runTaskAction, userId],
  );

  const toggleCompleted = useCallback(
    async (task) => {
      if (task.myActiveStartedAt) await stopTimer(task.id);
      return updateStatus(task.id, task.status === "completed" ? "pending" : "completed");
    },
    [stopTimer, updateStatus],
  );

  return {
    userId,
    plan,
    loading,
    error,
    syncNotice,
    pendingTaskIds,
    refresh,
    updateStatus,
    startTimer,
    stopTimer,
    fetchLastSession,
    adjustSession,
    toggleCompleted,
  };
}
