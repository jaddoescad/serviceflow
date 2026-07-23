import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeProjectLabourTaskRows } from "./projectLabourTaskModel";
import { supabase } from "./supabase";

const CACHE_PREFIX = "ottawaPainters.projectLabourTasks.v1";
const WRITE_QUEUE_KEY = "ottawaPainters.projectLabourTaskWrites.v1";
const TIMER_TABLE = "project_labour_task_time_entries";
const REASON_TABLE = "project_labour_task_over_budget_reasons";
const LIVE_STATE_TABLE = "project_labour_task_live_state";
const LIVE_TASKS_RPC = "list_project_labour_tasks_live";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OVER_BUDGET_REASON_KEYS = new Set([
  "budget_unrealistic",
  "extra_prep",
  "moving_furniture",
  "waiting",
  "other",
]);
let queueMutation = Promise.resolve();
let flushMutation = null;
let timerMutation = Promise.resolve();

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

function withoutRealtimePresence(plan) {
  if (!plan || !Array.isArray(plan.tasks)) return plan;
  return {
    ...plan,
    tasks: plan.tasks.map((task) => ({ ...task, activePainters: [] })),
  };
}

export async function readCachedProjectLabourTasks(projectId, userId) {
  if (!projectId || !userId) return null;
  try {
    const cached = parseJson(await AsyncStorage.getItem(cacheKey(projectId, userId)), null);
    if (!cached || !Array.isArray(cached.tasks)) return null;
    return withoutRealtimePresence(cached);
  } catch (_error) {
    return null;
  }
}

export async function writeCachedProjectLabourTasks(projectId, userId, plan) {
  if (!projectId || !userId || !plan) return;
  try {
    await AsyncStorage.setItem(
      cacheKey(projectId, userId),
      JSON.stringify(withoutRealtimePresence(plan)),
    );
  } catch (_error) {
    // Caching is best effort; the live task list remains authoritative.
  }
}

export async function listProjectLabourTasks(projectId) {
  if (!projectId) return { plan: { budget: null, tasks: [], fetchedAt: Date.now() }, error: null };
  await flushPendingProjectLabourTaskWrites();

  try {
    let result = await supabase.rpc(LIVE_TASKS_RPC, {
      requested_project_id: String(projectId),
    });
    if (isMissingLiveTasksFunction(result.error)) {
      result = await supabase.rpc("list_project_labour_tasks", {
        requested_project_id: String(projectId),
      });
    }
    const { data, error } = result;
    if (error) return { plan: null, error };

    let fallbackBudget = null;
    if (!(data || []).length) {
      const budgetResult = await supabase
        .from("project_labour_budgets")
        .select(
          "id,companycam_project_id,source_quote_id,source_quote_name,instructions,budgeted_hours,revision,published_at",
        )
        .eq("companycam_project_id", String(projectId))
        .eq("is_active", true)
        .maybeSingle();
      if (!budgetResult.error) fallbackBudget = budgetResult.data;
    }

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
        filter: `companycam_project_id=eq.${normalizedProjectId}`,
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

export async function startProjectLabourTaskTimer({
  taskId,
  userId,
  timeEntryId = null,
  startedAt = new Date().toISOString(),
  clientEntryId = operationId("task-timer"),
}) {
  const operation = {
    id: operationId("timer-start"),
    action: "timer_start",
    clientEntryId,
    taskId: String(taskId || ""),
    userId: String(userId || ""),
    timeEntryId: UUID_PATTERN.test(String(timeEntryId || "")) ? String(timeEntryId) : null,
    startedAt,
    createdAt: new Date().toISOString(),
  };
  return runTimerMutation(async () => {
    const result = await executeTaskOperation(operation);
    if (!result.error) return { ...result, queued: false, clientEntryId };
    if (!shouldQueueTaskOperation(result.error)) {
      return { ...result, queued: false, clientEntryId };
    }
    await enqueueTaskOperation(operation);
    return { ...result, queued: true, clientEntryId };
  });
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

export async function stopActiveProjectLabourTaskTimer({
  userId,
  endedAt = new Date().toISOString(),
} = {}) {
  if (!userId) return { data: [], error: null, queued: false };
  const operation = {
    id: operationId("timer-stop"),
    action: "timer_stop",
    userId: String(userId),
    endedAt,
    createdAt: new Date().toISOString(),
  };
  return runTimerMutation(async () => {
    const result = await executeTaskOperation(operation);
    if (!result.error) return { ...result, queued: false };
    if (!shouldQueueTaskOperation(result.error)) return { ...result, queued: false };
    await enqueueTaskOperation(operation);
    return { ...result, queued: true };
  });
}

export async function getMyLatestTaskSession(taskId, userId) {
  if (!taskId || !userId) return { data: null, error: null };
  try {
    const { data, error } = await supabase
      .from(TIMER_TABLE)
      .select("id,client_entry_id,task_id,started_at,ended_at,status")
      .eq("task_id", String(taskId))
      .eq("user_id", String(userId))
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { data: data || null, error };
  } catch (error) {
    return { data: null, error };
  }
}

export async function adjustProjectLabourTaskSession({
  entryId,
  userId,
  startedAt,
  minutes,
}) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const endedAt = new Date(
    new Date(startedAt).getTime() + safeMinutes * 60_000,
  ).toISOString();
  const operation = {
    id: operationId("timer-adjust"),
    action: "timer_adjust",
    entryId: String(entryId || ""),
    userId: String(userId || ""),
    endedAt,
    createdAt: new Date().toISOString(),
  };
  return runTimerMutation(async () => {
    const result = await executeTaskOperation(operation);
    if (!result.error) return { ...result, queued: false };
    if (!shouldQueueTaskOperation(result.error)) return { ...result, queued: false };
    await enqueueTaskOperation(operation);
    return { ...result, queued: true };
  });
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
  const { data: sessionData } = await supabase.auth.getSession();
  const currentUserId = sessionData?.session?.user?.id || null;
  if (!currentUserId) return;

  const completed = new Set();
  for (const operation of queue) {
    if (operation.userId && operation.userId !== currentUserId) continue;
    try {
      const result = operation.action.startsWith("timer_")
        ? await runTimerMutation(() => executeTaskOperation(operation))
        : await executeTaskOperation(operation);
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
    const { data, error } = await supabase.rpc("set_project_labour_task_status", {
      requested_task_id: operation.taskId,
      requested_status: operation.status,
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

    const inserted = await supabase
      .from(REASON_TABLE)
      .insert({
        client_id: operation.clientId,
        task_id: operation.taskId,
        user_id: operation.userId,
        reason: operation.reason,
        note: operation.note || null,
        hours_over: Math.max(0, Number(operation.hoursOver) || 0),
        budget_revision: operation.budgetRevision ?? null,
        created_at: operation.createdAt,
      })
      .select(
        "id,client_id,task_id,user_id,reason,note,hours_over,budget_revision,created_at",
      )
      .single();
    if (inserted.error?.code === "23505") {
      return { data: null, error: null };
    }
    return { data: inserted.data || null, error: inserted.error };
  }

  if (operation.action === "timer_stop") {
    const { data, error } = await supabase
      .from(TIMER_TABLE)
      .update({
        ended_at: operation.endedAt,
        status: "complete",
        updated_at: operation.endedAt,
      })
      .eq("user_id", operation.userId)
      .is("ended_at", null)
      .select("id,task_id,started_at,ended_at,status");
    return { data: data || [], error };
  }

  if (operation.action === "timer_adjust") {
    if (!operation.entryId || !operation.userId) {
      return { data: null, error: new Error("A session and signed-in painter are required.") };
    }
    // Only completed sessions can be corrected; the active timer uses Stop.
    // started_at is server-protected, so duration edits move ended_at only.
    const { data, error } = await supabase
      .from(TIMER_TABLE)
      .update({
        ended_at: operation.endedAt,
        status: "complete",
        updated_at: operation.createdAt,
      })
      .eq("id", operation.entryId)
      .eq("user_id", operation.userId)
      .not("ended_at", "is", null)
      .select("id,task_id,started_at,ended_at,status");
    if (!error && !(data || []).length) {
      return { data: null, error: new Error("That session could not be updated.") };
    }
    return { data: (data || [])[0] || null, error };
  }

  if (operation.action === "timer_start") {
    if (!operation.taskId || !operation.userId) {
      return { data: null, error: new Error("A task and signed-in painter are required.") };
    }

    const existing = await supabase
      .from(TIMER_TABLE)
      .select("id,client_entry_id,task_id,started_at,ended_at,status")
      .eq("client_entry_id", operation.clientEntryId)
      .maybeSingle();
    if (existing.error) return { data: null, error: existing.error };
    if (existing.data) return { data: existing.data, error: null };

    const stopped = await executeTaskOperation({
      action: "timer_stop",
      userId: operation.userId,
      endedAt: operation.startedAt,
    });
    if (stopped.error) return stopped;

    const payload = {
      client_entry_id: operation.clientEntryId,
      task_id: operation.taskId,
      user_id: operation.userId,
      time_entry_id: operation.timeEntryId || null,
      started_at: operation.startedAt,
      ended_at: null,
      status: "active",
      metadata: { source: "mobile" },
    };
    let inserted = await supabase.from(TIMER_TABLE).insert(payload).select().single();
    if (inserted.error?.code === "23503" && payload.time_entry_id) {
      // The whole-shift row may still be syncing from an offline clock-in. Task
      // time remains valid without the optional link and can still aggregate.
      inserted = await supabase
        .from(TIMER_TABLE)
        .insert({ ...payload, time_entry_id: null })
        .select()
        .single();
    }
    if (inserted.error?.code === "23505") {
      const duplicate = await supabase
        .from(TIMER_TABLE)
        .select("*")
        .eq("client_entry_id", operation.clientEntryId)
        .maybeSingle();
      return { data: duplicate.data || null, error: duplicate.error };
    }
    return { data: inserted.data || null, error: inserted.error };
  }

  return { data: null, error: new Error(`Unknown labour-task action: ${operation.action}`) };
}

function operationId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isMissingLiveTasksFunction(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "PGRST202" || code === "42883" || /list_project_labour_tasks_live.*does not exist/i.test(message);
}

function runTimerMutation(work) {
  const next = timerMutation.catch(() => {}).then(work);
  timerMutation = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
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
    if (operation.action === "timer_adjust") {
      return [
        ...queue.filter(
          (item) =>
            !(item.action === "timer_adjust" && item.entryId === operation.entryId),
        ),
        operation,
      ];
    }
    return [...queue, operation];
  });
}
