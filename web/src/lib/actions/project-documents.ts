"use server";

import { revalidatePath } from "next/cache";
import { requireMember, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_DOCUMENTS_BUCKET, type ProjectPageDocument } from "@/lib/project-document-types";
import { getProjectPageDocument } from "@/lib/project-documents";
import { sanitizeRichText } from "@/lib/rich-text";

export type ActionResult = { ok: boolean; error?: string };

function revalidateDocuments(projectId: string) {
  revalidatePath(`/jobs/${encodeURIComponent(projectId)}/documents`);
}

function cleanName(name: string, max: number): string | null {
  const value = name.trim();
  return value && value.length <= max ? value : null;
}

export async function createDocumentFolder(input: {
  projectId: string;
  name: string;
}): Promise<ActionResult> {
  const name = cleanName(input.name, 120);
  if (!name) return { ok: false, error: "Enter a folder name." };
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_document_folders")
    .insert({ project_id: input.projectId, name });
  if (error) return { ok: false, error: error.message };
  revalidateDocuments(input.projectId);
  return { ok: true };
}

export async function renameDocumentFolder(input: {
  projectId: string;
  folderId: string;
  name: string;
}): Promise<ActionResult> {
  const name = cleanName(input.name, 120);
  if (!name) return { ok: false, error: "Enter a folder name." };
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_document_folders")
    .update({ name })
    .eq("id", input.folderId)
    .eq("project_id", input.projectId);
  if (error) return { ok: false, error: error.message };
  revalidateDocuments(input.projectId);
  return { ok: true };
}

export async function deleteDocumentFolder(input: {
  projectId: string;
  folderId: string;
}): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_document_folders")
    .delete()
    .eq("id", input.folderId)
    .eq("project_id", input.projectId);
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23001" || error.code === "23503"
          ? "Move or delete the documents in this folder first."
          : error.message,
    };
  }
  revalidateDocuments(input.projectId);
  return { ok: true };
}

/** Record a file the browser already uploaded to the project's storage folder. */
export async function saveUploadedDocument(input: {
  projectId: string;
  folderId: string | null;
  name: string;
  storagePath: string;
  mimeType: string | null;
  byteSize: number;
}): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const name = cleanName(input.name, 200);
  const error = !name
    ? { message: "File name is too long." }
    : !input.storagePath.startsWith(`${input.projectId}/`)
      ? { message: "File is stored under another project." }
      : (
          await supabase.from("project_documents").insert({
            project_id: input.projectId,
            folder_id: input.folderId,
            name,
            storage_path: input.storagePath,
            mime_type: input.mimeType || null,
            byte_size: Math.max(0, Math.round(input.byteSize)),
          })
        ).error;
  if (error) {
    await supabase.storage.from(PROJECT_DOCUMENTS_BUCKET).remove([input.storagePath]);
    return { ok: false, error: error.message };
  }
  revalidateDocuments(input.projectId);
  return { ok: true };
}

export async function renameDocument(input: {
  projectId: string;
  documentId: string;
  name: string;
}): Promise<ActionResult & { updatedAt?: string }> {
  const name = cleanName(input.name, 200);
  if (!name) return { ok: false, error: "Enter a document name." };
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_documents")
    .update({ name })
    .eq("id", input.documentId)
    .eq("project_id", input.projectId)
    .select("updated_at")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Document not found." };
  revalidateDocuments(input.projectId);
  return { ok: true, updatedAt: data.updated_at };
}

export async function moveDocument(input: {
  projectId: string;
  documentId: string;
  folderId: string | null;
}): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_documents")
    .update({ folder_id: input.folderId })
    .eq("id", input.documentId)
    .eq("project_id", input.projectId);
  if (error) return { ok: false, error: error.message };
  revalidateDocuments(input.projectId);
  return { ok: true };
}

export async function deleteDocument(input: {
  projectId: string;
  documentId: string;
}): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_documents")
    .delete()
    .eq("id", input.documentId)
    .eq("project_id", input.projectId)
    .select("storage_path,kind")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Document not found." };
  const bucket = supabase.storage.from(PROJECT_DOCUMENTS_BUCKET);
  let paths: string[] = data.storage_path ? [data.storage_path] : [];
  if (data.kind === "page") {
    const folder = `${input.projectId}/pages/${input.documentId}`;
    const { data: images } = await bucket.list(folder, { limit: 1000 });
    paths = (images ?? []).map((image) => `${folder}/${image.name}`);
  }
  if (paths.length) {
    const removed = await bucket.remove(paths);
    if (removed.error) console.error("project document file cleanup", removed.error.message);
  }
  revalidateDocuments(input.projectId);
  return { ok: true };
}

/** Create an empty rich text page and return its id so the editor can open it. */
export async function createPageDocument(input: {
  projectId: string;
  folderId: string | null;
}): Promise<ActionResult & { documentId?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_documents")
    .insert({
      project_id: input.projectId,
      folder_id: input.folderId,
      name: "Untitled",
      kind: "page",
      body_html: "",
      mime_type: "text/html",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidateDocuments(input.projectId);
  return { ok: true, documentId: data.id };
}

/**
 * The page as saved now. The editor calls this on open because Next can show a
 * cached copy of the page from before the last edits.
 */
export async function loadPageDocument(projectId: string, documentId: string): Promise<ProjectPageDocument | null> {
  await requireMember();
  return getProjectPageDocument(projectId, documentId);
}

/**
 * Save a page's body. `expectedUpdatedAt` is the version the editor loaded; a
 * mismatch means someone else saved in between, so nothing is overwritten.
 */
export async function savePageDocument(input: {
  projectId: string;
  documentId: string;
  bodyHtml: string;
  expectedUpdatedAt: string;
}): Promise<ActionResult & { updatedAt?: string; conflict?: boolean }> {
  await requireStaff();
  const bodyHtml = sanitizeRichText(input.bodyHtml);
  if (bodyHtml.length > 1_000_000) return { ok: false, error: "This document is too long to save." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_documents")
    .update({ body_html: bodyHtml, byte_size: bodyHtml.length })
    .eq("id", input.documentId)
    .eq("project_id", input.projectId)
    .eq("kind", "page")
    .eq("updated_at", input.expectedUpdatedAt)
    .select("updated_at")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) {
    return {
      ok: false,
      conflict: true,
      error: "Someone else changed this document. Reload to see the latest version.",
    };
  }
  // No revalidatePath here: autosave must not re-render the open editor.
  return { ok: true, updatedAt: data.updated_at };
}
