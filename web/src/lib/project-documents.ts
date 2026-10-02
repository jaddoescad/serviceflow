import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

import type {
  ProjectDocument,
  ProjectDocumentFolder,
  ProjectPageDocument,
} from "@/lib/project-document-types";
import { sanitizeRichText } from "@/lib/rich-text";

type Updater = { full_name: string | null } | { full_name: string | null }[] | null;

function updaterName(updater: Updater): string | null {
  const row = Array.isArray(updater) ? updater[0] : updater;
  return row?.full_name ?? null;
}

export const getProjectDocuments = cache(async (projectId: string) => {
  const supabase = await createClient();
  const [documents, folders] = await Promise.all([
    supabase
      .from("project_documents")
      .select(
        "id,name,kind,folder_id,mime_type,byte_size,updated_at,updater:employees!project_documents_updated_by_fkey(full_name)",
      )
      .eq("project_id", projectId),
    supabase
      .from("project_document_folders")
      .select(
        "id,name,updated_at,updater:employees!project_document_folders_updated_by_fkey(full_name)",
      )
      .eq("project_id", projectId),
  ]);
  if (documents.error) throw new Error(`project documents: ${documents.error.message}`);
  if (folders.error) throw new Error(`project document folders: ${folders.error.message}`);

  return {
    documents: documents.data.map(
      (row): ProjectDocument => ({
        id: row.id,
        name: row.name,
        kind: row.kind === "page" ? "page" : "file",
        folderId: row.folder_id,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size ?? 0),
        updatedAt: row.updated_at,
        updatedByName: updaterName(row.updater as Updater),
      }),
    ),
    folders: folders.data.map(
      (row): ProjectDocumentFolder => ({
        id: row.id,
        name: row.name,
        updatedAt: row.updated_at,
        updatedByName: updaterName(row.updater as Updater),
      }),
    ),
  };
});

export const getProjectDocumentCount = cache(async (projectId: string) => {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("project_documents")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (error) throw new Error(`project document count: ${error.message}`);
  return count ?? 0;
});

export const getProjectPageDocument = cache(
  async (projectId: string, documentId: string): Promise<ProjectPageDocument | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_documents")
      .select("id,project_id,name,body_html,updated_at")
      .eq("id", documentId)
      .eq("project_id", projectId)
      .eq("kind", "page")
      .maybeSingle();
    if (error) throw new Error(`project page: ${error.message}`);
    if (!data) return null;
    return {
      id: data.id,
      projectId: data.project_id,
      name: data.name,
      bodyHtml: sanitizeRichText(data.body_html ?? ""),
      updatedAt: data.updated_at,
    };
  },
);
