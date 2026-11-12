"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Settings › Templates › Task templates. Adding one to a job copies its tasks
// into the job's list; the template itself never changes a job afterwards.

export type TaskTemplateItem = { title: string; notes: string | null };
export type TaskTemplate = { id: string; name: string; tasks: TaskTemplateItem[] };
type ActionResult = { ok: boolean; error?: string };

function cleanItems(items: unknown): TaskTemplateItem[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const title = typeof item?.title === "string" ? item.title.trim() : "";
    if (!title) return [];
    const notes = typeof item?.notes === "string" ? item.notes.trim() : "";
    return [{ title, notes: notes || null }];
  });
}

/** The company's task templates. Only managers can read them. */
export async function getTaskTemplates(): Promise<TaskTemplate[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from("task_templates").select("id,name,items").order("created_at");
  if (error) throw new Error(`task templates: ${error.message}`);
  return data.map((row) => ({ id: row.id, name: row.name, tasks: cleanItems(row.items) }));
}

/** Create a template (no id) or replace an existing one's name and tasks. */
export async function saveTaskTemplate(input: {
  id: string | null;
  name: string;
  tasks: TaskTemplateItem[];
}): Promise<ActionResult> {
  const name = input.name.trim();
  const items = cleanItems(input.tasks);
  if (!name) return { ok: false, error: "Give the template a name." };
  if (!items.length) return { ok: false, error: "Add at least one task." };
  if (items.length > 100) return { ok: false, error: "A template can hold up to 100 tasks." };
  await requireStaff();
  const supabase = await createClient();
  const { error } = input.id
    ? await supabase.from("task_templates").update({ name, items }).eq("id", input.id)
    : await supabase.from("task_templates").insert({ name, items });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings", "layout");
  return { ok: true };
}

export async function deleteTaskTemplate(id: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("task_templates").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings", "layout");
  return { ok: true };
}

/** Add a template's tasks to the end of a job's task list. */
export async function applyTaskTemplate(input: { projectId: string; templateId: string }): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_task_template", {
    requested_job_id: input.projectId,
    requested_template_id: input.templateId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/deals/[id]", "page");
  revalidatePath("/jobs");
  revalidatePath("/");
  return { ok: true };
}
