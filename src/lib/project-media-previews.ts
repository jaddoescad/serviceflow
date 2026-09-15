import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketingLeadMedia } from "@/lib/types";
const POSTGREST_IN_FILTER_BATCH_SIZE = 50;
export async function getProjectMediaPreviews(supabase: SupabaseClient, projects: { id: string; kind: "job" | "lead" }[]) {
  const leadOwners = projects.filter(project => project.kind === "lead").map(project => project.id);
  const jobOwners = projects.filter(project => project.kind === "job").map(project => project.id);
  const mediaRequests: Array<PromiseLike<{ data: any[] | null; error: any }>> = [];
  for (const [table, foreignKey, owners] of [
    ["leads", "job_media_lead_id_fkey", leadOwners],
    ["jobs", "job_media_job_id_fkey", jobOwners],
  ] as const) {
    for (let index = 0; index < owners.length; index += POSTGREST_IN_FILTER_BATCH_SIZE) {
      // Limit each embedded gallery, not the combined media rows for 200 projects.
      // The separate aggregate counts all visible media, including videos.
      mediaRequests.push(supabase.from(table)
        .select(`id,media:job_media!${foreignKey}(id,media_type),media_count:job_media!${foreignKey}(count)`)
        .in("id", owners.slice(index, index + POSTGREST_IN_FILTER_BATCH_SIZE))
        .eq("media.media_type", "image")
        .order("captured_at", { referencedTable: "media", ascending: false, nullsFirst: false })
        .order("created_at", { referencedTable: "media", ascending: false })
        .order("id", { referencedTable: "media", ascending: true })
        .limit(2, { referencedTable: "media" }));
    }
  }
  const mediaByOwner = new Map<string, { media: MarketingLeadMedia[]; mediaCount: number }>();
  for (const result of await Promise.all(mediaRequests)) {
    if (result.error) throw new Error(`lead media: ${result.error.message}`);
    for (const row of result.data ?? []) {
      mediaByOwner.set(row.id, {
        media: (row.media ?? []).map((item: any) => ({
          id: item.id, ownerProjectId: row.id, mediaType: "image" as const,
        })),
        mediaCount: Number(row.media_count?.[0]?.count ?? 0),
      });
    }
  }
  return mediaByOwner;
}
