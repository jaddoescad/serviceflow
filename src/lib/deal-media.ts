import { createClient } from "@/lib/supabase/client";
import type { MarketingLead, MarketingLeadMedia } from "@/lib/types";
const POSTGREST_IN_FILTER_BATCH_SIZE = 50;
export async function getDealMedia(leads: MarketingLead[]) {
  const supabase = createClient();
  const leadMediaOwners = leads
    .filter((lead) => !lead.job)
    .map((lead) => lead.leadId);
  const jobMediaOwners = leads.flatMap((lead) =>
    lead.job ? [lead.job.jobId] : [],
  );
  const mediaRequests: Array<PromiseLike<{ data: any[] | null; error: any }>> = [];
  for (const [table, foreignKey, owners] of [
    ["leads", "job_media_lead_id_fkey", leadMediaOwners],
    ["jobs", "job_media_job_id_fkey", jobMediaOwners],
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
  return leads.map(lead => ({
    ...lead,
    ...(mediaByOwner.get(lead.job?.jobId ?? lead.leadId) ?? { media: [], mediaCount: 0 }),
  }));
}
