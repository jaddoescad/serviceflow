import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  listProjectLabourTasks,
  readCachedProjectLabourTasks,
  setProjectLabourTaskStatus,
  submitOverBudgetReason as persistOverBudgetReason,
  subscribeToProjectLabourTaskChanges,
  writeCachedProjectLabourTasks,
} from "./projectLabourTasks";
import {
  hasAnsweredLabourTaskOverBudgetReason,
  markLabourTaskOverBudgetReasonAnswered,
} from "./timeTrackingStorage";

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
        // Discard any in-flight background refresh so a stale response cannot
        // overwrite the optimistic checkbox state (visible as a flicker).
        requestIdRef.current += 1;
        persistPlan((current) => ({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  status,
                  completedAt: status === "completed" ? new Date().toISOString() : null,
                }
              : task,
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
          await refresh({ silent: true });
        }
        return result;
      }),
    [persistPlan, refresh, runTaskAction, userId],
  );

  const hasAnsweredOverBudgetReason = useCallback(
    (task) =>
      hasAnsweredLabourTaskOverBudgetReason(
        userId,
        task?.id,
        planRef.current.budget?.revision,
      ),
    [userId],
  );

  const markOverBudgetReasonAnswered = useCallback(
    (task) =>
      markLabourTaskOverBudgetReasonAnswered(
        userId,
        task?.id,
        planRef.current.budget?.revision,
      ),
    [userId],
  );

  const submitOverBudgetReason = useCallback(
    async (task, { reason, note = null, hoursOver = 0 } = {}) => {
      if (!userId || !task?.id) {
        const result = {
          error: new Error("A task and signed-in painter are required."),
          queued: false,
        };
        setError(friendlyTaskError(result.error));
        return result;
      }

      const result = await persistOverBudgetReason({
        taskId: task.id,
        userId,
        reason,
        note,
        hoursOver,
        budgetRevision: planRef.current.budget?.revision ?? null,
      });
      await markOverBudgetReasonAnswered(task);
      if (result.queued) {
        setSyncNotice(
          "Thanks — your note is saved on this device. It will sync when ServiceFlow reconnects.",
        );
      } else if (result.error) {
        setError(friendlyTaskError(result.error));
      } else {
        setError("");
      }
      return result;
    },
    [markOverBudgetReasonAnswered, userId],
  );

  const skipOverBudgetReason = useCallback(
    (task) => markOverBudgetReasonAnswered(task),
    [markOverBudgetReasonAnswered],
  );

  const toggleCompleted = useCallback(
    (task) => updateStatus(task.id, task.status === "completed" ? "pending" : "completed"),
    [updateStatus],
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
    hasAnsweredOverBudgetReason,
    submitOverBudgetReason,
    skipOverBudgetReason,
    toggleCompleted,
  };
}
