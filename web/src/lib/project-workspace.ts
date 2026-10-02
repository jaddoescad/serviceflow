import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/auth";

export type ProjectLabel = {
  id: string;
  name: string;
  color: string;
  updated_at?: string;
  project_count?: number;
};
export type WorkspaceProject = {
  id: string;
  kind: "job" | "lead";
  contact_id: string;
  name: string;
  address: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  trashed_at: string | null;
  labels: ProjectLabel[];
};
export const getProjectLabels = cache(async (): Promise<ProjectLabel[]> => {
  const client = await createClient();
  const { data, error } = await client
    .from("project_labels")
    .select("id,name,color,updated_at,project_label_links(count)")
    .order("name");
  if (error) throw new Error("Could not load project labels.");
  return (data ?? []).map(({ project_label_links, ...label }) => ({
    ...label,
    project_count: project_label_links[0]?.count ?? 0,
  }));
});
export const getWorkspaceProject = cache(
  async (id: string): Promise<WorkspaceProject | null> => {
    const client = await createClient();
    // RLS guards the row; the membership check runs alongside the query.
    const [, { data, error }] = await Promise.all([
      requireMember(),
      client.from("project_directory").select("*").eq("id", id).maybeSingle(),
    ]);
    if (error) throw new Error("Could not load project.");
    return data;
  },
);

export type ProjectPreview = { id: string; media_type: string };
export type ProjectPreviews = Record<string, ProjectPreview[]>;

/**
 * Up to three recent photos per project (the cover first), fetched together by
 * the database. Thumbnails are decoration, so a failure shows empty frames
 * instead of failing the page they are streamed into.
 */
export async function getProjectPreviews(projectIds: string[]): Promise<ProjectPreviews> {
  const previews: ProjectPreviews = {};
  if (!projectIds.length) return previews;
  const client = await createClient();
  const { data, error } = await client.rpc("project_directory_previews", {
    requested_ids: projectIds,
  });
  if (error) {
    console.error("Project previews could not load:", error.message);
    return previews;
  }
  for (const row of data ?? []) (previews[row.project_id] ??= []).push({ id: row.id, media_type: row.media_type });
  return previews;
}
