"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DocumentTemplate } from "@/lib/project-document-types";
import { sanitizeRichText } from "@/lib/rich-text";
import type { ActionResult } from "./project-documents";

// Settings › Document templates. Every new job gets a copy of each template in
// its Documents (a database trigger makes the copies).

export async function getDocumentTemplates(): Promise<{ id: string; name: string }[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_document_templates")
    .select("id,name")
    .order("created_at");
  if (error) throw new Error(`document templates: ${error.message}`);
  return data;
}

export async function getDocumentTemplate(templateId: string): Promise<DocumentTemplate | null> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_document_templates")
    .select("id,name,body_html,updated_at")
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw new Error(`document template: ${error.message}`);
  if (!data) return null;
  return { id: data.id, name: data.name, bodyHtml: sanitizeRichText(data.body_html), updatedAt: data.updated_at };
}

/** Create an empty template and return its id so the editor can open it. */
export async function createDocumentTemplate(): Promise<ActionResult & { templateId?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_document_templates")
    .insert({ name: "Untitled" })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, templateId: data.id };
}

/** Save a template's body unless someone else saved since `expectedUpdatedAt`. */
export async function saveDocumentTemplate(input: {
  templateId: string;
  bodyHtml: string;
  expectedUpdatedAt: string;
}): Promise<ActionResult & { updatedAt?: string; conflict?: boolean }> {
  await requireStaff();
  const bodyHtml = sanitizeRichText(input.bodyHtml);
  if (bodyHtml.length > 1_000_000) return { ok: false, error: "This template is too long to save." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_document_templates")
    .update({ body_html: bodyHtml })
    .eq("id", input.templateId)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("updated_at")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) {
    return {
      ok: false,
      conflict: true,
      error: "Someone else changed this template. Reload to see the latest version.",
    };
  }
  return { ok: true, updatedAt: data.updated_at };
}

export async function renameDocumentTemplate(input: {
  templateId: string;
  name: string;
}): Promise<ActionResult & { updatedAt?: string }> {
  const name = input.name.trim();
  if (!name || name.length > 200) return { ok: false, error: "Enter a template name." };
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_document_templates")
    .update({ name })
    .eq("id", input.templateId)
    .select("updated_at")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Template not found." };
  revalidatePath("/settings");
  return { ok: true, updatedAt: data.updated_at };
}

/** Jobs that already have a copy keep it. */
export async function deleteDocumentTemplate(templateId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_document_templates")
    .delete()
    .eq("id", templateId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Template not found." };
  revalidatePath("/settings");
  return { ok: true };
}
