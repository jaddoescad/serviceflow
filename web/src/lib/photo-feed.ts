import { requireMember } from "@/lib/auth";
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

export type PhotoCursor = {
  capturedAt: string | null;
  createdAt: string;
  id: string;
};
export type PhotoBatch = {
  items: PhotoFeedItem[];
  nextCursor: PhotoCursor | null;
};
export type PhotoSummary = {
  total: number;
  tags: string[];
  projects: [string, string][];
  creators: [string, number][];
};
export type PhotoFilters = {
  tag_filters?: string[] | null;
  uploader_filter?: string | null;
  project_filters: string[] | null;
  creator_filters: string[] | null;
  media_filter: string | null;
  since_filter: string | null;
  until_filter?: string | null;
  oldest_first?: boolean;
};

export async function getPhotoFeed(
  filters?: PhotoFilters,
  cursor: PhotoCursor | null = null,
  options = true,
) {
  const supabase = await createClient();
  const [batch, summary, tags] = await Promise.all([
    supabase.rpc("get_workspace_media_page", {
      ...filters,
      after_cursor: cursor,
    }),
    cursor || !options
      ? Promise.resolve(null)
      : supabase.rpc("get_workspace_photo_feed_summary", {
          include_options: options,
        }),
    cursor || !options
      ? Promise.resolve(null)
      : supabase.rpc("get_workspace_photo_tags"),
    requireMember(),
  ]);
  if (batch.error) throw new Error(`photo feed: ${batch.error.message}`);
  if (summary?.error)
    throw new Error(`photo summary: ${summary.error.message}`);
  if (tags?.error) throw new Error("Photo tags could not load.");
  return {
    batch: batch.data as PhotoBatch,
    summary: summary?.data
      ? ({ ...summary.data, tags: tags?.data ?? [] } as PhotoSummary)
      : undefined,
  };
}
