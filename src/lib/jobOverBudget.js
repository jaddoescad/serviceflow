import { listProjectBudgetProgress } from "./projectBudget";
import { supabase } from "./supabase";
import {
  hasAnsweredLabourTaskOverBudgetReason,
  markLabourTaskOverBudgetReasonAnswered,
} from "./timeTrackingStorage";

// Job-level over-budget prompt shown at clock-out. Reuses the answered-once
// storage with a "job:" pseudo id so each painter is asked once per job.
const jobKey = (projectId) => `job:${String(projectId || "")}`;

export async function evaluateJobOverBudget(projectId) {
  const normalizedId = String(projectId || "");
  if (!normalizedId) return { over: false, hoursOver: 0 };
  const { progressByProjectId, error } = await listProjectBudgetProgress([normalizedId]);
  if (error) return { over: false, hoursOver: 0 };
  const progress = progressByProjectId[normalizedId];
  if (
    !progress ||
    progress.percentUsed == null ||
    progress.percentUsed <= 100 ||
    !(progress.hoursUsed > 0)
  ) {
    return { over: false, hoursOver: 0 };
  }
  const budgetedHours = progress.hoursUsed * (100 / progress.percentUsed);
  return { over: true, hoursOver: Math.max(0, progress.hoursUsed - budgetedHours) };
}

export function hasAnsweredJobOverBudgetReason(userId, projectId) {
  return hasAnsweredLabourTaskOverBudgetReason(userId, jobKey(projectId), null);
}

export function markJobOverBudgetReasonAnswered(userId, projectId) {
  return markLabourTaskOverBudgetReasonAnswered(userId, jobKey(projectId), null);
}

export async function submitJobOverBudgetReason({
  projectId,
  userId,
  reason,
  note = null,
  hoursOver = 0,
}) {
  if (!projectId || !userId || !reason) {
    return { error: new Error("A job, signed-in painter, and reason are required.") };
  }
  const clientId = `job-obr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const inserted = await supabase.from("project_over_budget_reasons").insert({
    client_id: clientId,
    companycam_project_id: String(projectId),
    user_id: String(userId),
    reason: String(reason),
    note: typeof note === "string" ? note.trim().slice(0, 280) || null : null,
    hours_over: Math.max(0, Number(hoursOver) || 0),
  });
  if (inserted.error?.code === "23505") return { error: null };
  return { error: inserted.error };
}
