import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type PhotoFeedItem = {
  id: string;
  ownerProjectId: string;
  ownerKind: "job" | "lead";
  projectName: string;
  address: string | null;
  mediaType: "image" | "video";
  mimeType: string;
  durationMs: number | null;
  capturedAt: string;
  creatorName: string;
  description: string | null;
};

export type PhotoCursor = { capturedAt: string | null; createdAt: string; id: string };
export type PhotoBatch = { items: PhotoFeedItem[]; nextCursor: PhotoCursor | null };
export type PhotoSummary = { total: number; projects: [string, string][]; creators: [string, number][] };
export type PhotoFilters = { project_filter: string | null; creator_filter: string | null; media_filter: string | null; since_filter: string | null };

export async function getPhotoFeed(filters?: PhotoFilters, cursor: PhotoCursor | null = null, options = true) {
  const supabase = await createClient();
  const [batch, summary] = await Promise.all([
    supabase.rpc("get_photo_feed_page", { ...filters, after_cursor: cursor }),
    cursor ? Promise.resolve(null) : supabase.rpc("get_photo_feed_summary", { ...filters, include_options: options }),
    requireStaff(),
  ]);
  if (batch.error) throw new Error(`photo feed: ${batch.error.message}`);
  if (summary?.error) throw new Error(`photo summary: ${summary.error.message}`);
  return { batch: batch.data as PhotoBatch, summary: summary?.data as PhotoSummary | undefined };
}
