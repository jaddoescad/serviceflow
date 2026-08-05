import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeProjectLabourTaskRows } from "./projectLabourTaskModel";
import { supabase } from "./supabase";

const CACHE_PREFIX = "ottawaPainters.projectLabourTasks.v1";
const WRITE_QUEUE_KEY = "ottawaPainters.projectLabourTaskWrites.v1";
const LIVE_STATE_TABLE = "job_tasks";
const OVER_BUDGET_REASON_KEYS = new Set([
  "budget_unrealistic",
  "extra_prep",
  "moving_furniture",
  "waiting",
  "other",
]);
let queueMutation = Promise.resolve();
let flushMutation = null;

function cacheKey(projectId, userId) {
  return `${CACHE_PREFIX}:${String(userId || "")}:${String(projectId || "")}`;
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function withoutTaskTimerState(plan) {
  if (!plan || !Array.isArray(plan.tasks)) return plan;
  return {
    ...plan,
    tasks: plan.tasks.map(({ hoursSpent, myActiveStartedAt, activePainters, ...task }) => task),
  };
}

export async function readCachedProjectLabourTasks(projectId, userId) {
  if (!projectId || !userId) return null;
  try {
    const cached = parseJson(await AsyncStorage.getItem(cacheKey(projectId, userId)), null);
    if (!cached || !Array.isArray(cached.tasks)) return null;
    return withoutTaskTimerState(cached);
  } catch (_error) {
    return null;
  }
}

export async function writeCachedProjectLabourTasks(projectId, userId, plan) {
  if (!projectId || !userId || !plan) return;
  try {
    await AsyncStorage.setItem(
      cacheKey(projectId, userId),
      JSON.stringify(withoutTaskTimerState(plan)),
    );
  } catch (_error) {
    // Caching is best effort; the live task list remains authoritative.
  }
}

export async function listProjectLabourTasks(projectId) {
  if (!projectId) return { plan: { budget: null, tasks: [], fetchedAt: Date.now() }, error: null };
  await flushPendingProjectLabourTaskWrites();

  try {
    const [{ data: tasks, error }, { data: budget, error: budgetError }] = await Promise.all([
      supabase.from("job_tasks").select("*").eq("job_id", String(projectId)).order("sort_order"),
      supabase.from("job_budgets").select("*").eq("job_id", String(projectId)).in("status", ["active", "closed"]).order("version", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (error || budgetError) return { plan: null, error: error || budgetError };

    const data = (tasks || []).map((task) => ({
      ...task,
      task_id: task.id,
      labour_budget_id: task.budget_id,
      companycam_project_id: task.job_id,
      task_budgeted_hours: task.budget_minutes == null ? 0 : Number(task.budget_minutes) / 60,
    }));
    const fallbackBudget = budget ? {
      ...budget,
      companycam_project_id: budget.job_id,
      source_quote_id: budget.quote_id,
      source_quote_name: "Labour plan",
      budgeted_hours: budget.budget_minutes == null ? 0 : Number(budget.budget_minutes) / 60,
      revision: budget.version,
      published_at: budget.created_at,
    } : null;

    const plan = {
      ...normalizeProjectLabourTaskRows(data || [], fallbackBudget),
      fetchedAt: Date.now(),
    };
    return { plan, error: null };
  } catch (error) {
    return { plan: null, error };
  }
}

export function subscribeToProjectLabourTaskChanges(
  projectId,
  { onChange, onStatus } = {},
) {
  const normalizedProjectId = String(projectId || "");
  if (!normalizedProjectId) return () => {};

  const channel = supabase
    .channel(`project-labour-task-state:${normalizedProjectId}:${operationId("watch")}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: LIVE_STATE_TABLE,
        filter: `job_id=eq.${normalizedProjectId}`,
      },
      (payload) => onChange?.(payload),
    )
    .subscribe((status, error) => onStatus?.(status, error));

  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

export async function setProjectLabourTaskStatus(taskId, status, { userId = null } = {}) {
  const operation = {
    id: operationId("task-status"),
    action: "status",
    taskId: String(taskId || ""),
    userId: userId ? String(userId) : null,
    status,
    createdAt: new Date().toISOString(),
  };
  const result = await executeTaskOperation(operation);
  if (!result.error) return { ...result, queued: false };
  if (!shouldQueueTaskOperation(result.error)) return { ...result, queued: false };
  await enqueueTaskOperation(operation);
  return { ...result, queued: true };
}

export async function submitOverBudgetReason({
  taskId,
  userId,
  reason,
  note = null,
  hoursOver = 0,
  budgetRevision = null,
  clientId = operationId("obr"),
}) {
  const normalizedNote = typeof note === "string" ? note.trim() || null : null;
  const hasBudgetRevision =
    budgetRevision !== null && budgetRevision !== undefined && budgetRevision !== "";
  const numericRevision = Number(budgetRevision);
  const operation = {
    id: operationId("over-budget-reason"),
    action: "over_budget_reason",
    clientId: String(clientId || ""),
    taskId: String(taskId || ""),
    userId: String(userId || ""),
    reason: String(reason || ""),
    note: normalizedNote,
    hoursOver: Math.max(0, Number(hoursOver) || 0),
    budgetRevision:
      hasBudgetRevision && Number.isInteger(numericRevision) ? numericRevision : null,
    createdAt: new Date().toISOString(),
  };
  const result = await executeTaskOperation(operation);
  if (!result.error) return { ...result, queued: false, clientId: operation.clientId };
  if (!shouldQueueTaskOperation(result.error)) {
    return { ...result, queued: false, clientId: operation.clientId };
  }
  await enqueueTaskOperation(operation);
  return { ...result, queued: true, clientId: operation.clientId };
}

export async function flushPendingProjectLabourTaskWrites() {
  if (flushMutation) return flushMutation;
  flushMutation = performFlush().finally(() => {
    flushMutation = null;
  });
  return flushMutation;
}

async function performFlush() {
  const queue = await readQueue();
  if (!queue.length) return;
  const obsoleteIds = new Set(
    queue.filter((operation) => operation.action.startsWith("timer_")).map((operation) => operation.id),
  );
  if (obsoleteIds.size) {
    await mutateQueue((current) => current.filter((item) => !obsoleteIds.has(item.id)));
  }
  const actionable = queue.filter((operation) => !obsoleteIds.has(operation.id));
  if (!actionable.length) return;
  const { data: sessionData } = await supabase.auth.getSession();
  const currentUserId = sessionData?.session?.user?.id || null;
  if (!currentUserId) return;

  const completed = new Set();
  for (const operation of actionable) {
    if (operation.userId && operation.userId !== currentUserId) continue;
    try {
      const result = await executeTaskOperation(operation);
      if (!result.error || !shouldQueueTaskOperation(result.error)) {
        completed.add(operation.id);
      }
    } catch (_error) {
      // Leave the operation queued for the next app-active/network retry.
    }
  }
  if (completed.size) {
    await mutateQueue((current) => current.filter((item) => !completed.has(item.id)));
  }
}

async function executeTaskOperation(operation) {
  if (operation.action === "status") {
    const { data, error } = await supabase.rpc("set_job_task_status", {
      requested_task_id: operation.taskId,
      requested_status: operation.status === "skipped" ? "cancelled" : operation.status,
    });
    return { data: Array.isArray(data) ? data[0] || null : data, error };
  }

  if (operation.action === "over_budget_reason") {
    if (
      !operation.taskId ||
      !operation.userId ||
      !operation.clientId ||
      !OVER_BUDGET_REASON_KEYS.has(operation.reason)
    ) {
      return {
        data: null,
        error: new Error("A task, signed-in painter, and valid reason are required."),
      };
    }
    if (operation.note && operation.note.length > 280) {
      return { data: null, error: new Error("The over-budget note is too long.") };
    }

    const { data, error } = await runTaskCommand("task_issue", {
      client_id: operation.clientId,
      task_id: operation.taskId,
      reason: operation.reason,
      note: operation.note || null,
      minutes_over: Math.round(Math.max(0, Number(operation.hoursOver) || 0) * 60),
      metadata: { budget_revision: operation.budgetRevision },
    });
    return { data, error };
  }

  return { data: null, error: new Error(`Unknown labour-task action: ${operation.action}`) };
}

function operationId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function runTaskCommand(action, command) {
  return supabase.rpc("record_time_entry_command", {
    action,
    command,
    next_command: null,
  });
}

function shouldQueueTaskOperation(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (
    code === "42501" ||
    code.startsWith("22") ||
    code.startsWith("23") ||
    code.startsWith("PGRST")
  ) {
    return false;
  }
  return /fetch|network|offline|timeout|connection/i.test(message);
}

async function readQueueSnapshot() {
  try {
    const queue = parseJson(await AsyncStorage.getItem(WRITE_QUEUE_KEY), []);
    return Array.isArray(queue) ? queue : [];
  } catch (_error) {
    return [];
  }
}

async function readQueue() {
  await queueMutation;
  return readQueueSnapshot();
}

function mutateQueue(work) {
  const next = queueMutation.catch(() => {}).then(async () => {
    const current = await readQueueSnapshot();
    const updated = await work(current);
    await AsyncStorage.setItem(WRITE_QUEUE_KEY, JSON.stringify(updated));
    return updated;
  });
  queueMutation = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function enqueueTaskOperation(operation) {
  return mutateQueue((queue) => {
    if (operation.action === "status") {
      return [
        ...queue.filter(
          (item) =>
            !(
              item.action === "status" &&
              item.taskId === operation.taskId &&
              item.userId === operation.userId
            ),
        ),
        operation,
      ];
    }
    return [...queue, operation];
  });
}
