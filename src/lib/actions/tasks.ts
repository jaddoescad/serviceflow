"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; error?: string };

function revalidateTaskViews(projectId: string) {
  revalidatePath(`/jobs/${encodeURIComponent(projectId)}`);
  revalidatePath(`/jobs/${encodeURIComponent(projectId)}/tasks`);
  revalidatePath("/jobs");
  revalidatePath("/");
}

function validateTaskInput(input: { title: string; budgetedHours: number | null }): string | null {
  if (!input.title.trim()) return "Enter a task title.";
  if (input.budgetedHours != null && (!Number.isFinite(input.budgetedHours) || input.budgetedHours < 0)) {
    return "Task hours must be zero or greater.";
  }
  return null;
}

/** Add a manual painter task. It survives calculator re-publishes. */
export async function addProjectTask(input: {
  projectId: string;
  title: string;
  notes?: string | null;
  budgetedHours: number | null;
}): Promise<ActionResult> {
  const invalid = validateTaskInput(input);
  if (invalid) return { ok: false, error: invalid };
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.rpc("save_job_task", {
    requested_job_id: input.projectId,
    requested_task_id: null,
    requested_title: input.title.trim(),
    requested_notes: input.notes?.trim() || null,
    requested_budget_minutes:
      input.budgetedHours == null ? null : Math.round(input.budgetedHours * 60),
    requested_sort_order: 0,
  });
  if (error) return { ok: false, error: error.message };

  revalidateTaskViews(input.projectId);
  return { ok: true };
}

/** Update a painter task's title, notes, and budgeted hours. */
export async function updateProjectTask(input: {
  projectId: string;
  taskId: string;
  title: string;
  notes?: string | null;
  budgetedHours: number | null;
}): Promise<ActionResult> {
  const invalid = validateTaskInput(input);
  if (invalid) return { ok: false, error: invalid };
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.rpc("save_job_task", {
    requested_job_id: input.projectId,
    requested_task_id: input.taskId,
    requested_title: input.title.trim(),
    requested_notes: input.notes?.trim() || null,
    requested_budget_minutes:
      input.budgetedHours == null ? null : Math.round(input.budgetedHours * 60),
    requested_sort_order: 0,
  });
  if (error) return { ok: false, error: error.message };

  revalidateTaskViews(input.projectId);
  return { ok: true };
}

/** Remove a painter task (soft delete — recorded time is preserved). */
export async function removeProjectTask(input: {
  projectId: string;
  taskId: string;
}): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_job_task_status", {
    requested_task_id: input.taskId,
    requested_status: "cancelled",
  });
  if (error) return { ok: false, error: error.message };

  revalidateTaskViews(input.projectId);
  return { ok: true };
}
