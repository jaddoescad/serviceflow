"use server";

import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { validPhotoId } from "@/lib/photo-link";
import type { BatchMediaItem } from "@/lib/photo-batch";

export async function loadFeedSelection(
  ids: string[],
): Promise<BatchMediaItem[]> {
  await requireMember();
  if (!ids.length || ids.length > 500 || ids.some((id) => !validPhotoId(id)))
    throw new Error("Select up to 500 photos or videos.");
  const client = await createClient();
  const { data, error } = await client
    .from("job_media")
    .select(
      "id,job_id,lead_id,media_type,mime_type,original_filename,duration_ms,captured_at,created_at,source_metadata",
    )
    .in("id", ids);
  if (error || data?.length !== ids.length)
    throw new Error(
      "Some selected photos are no longer available. Refresh and select them again.",
    );
  return data.map((row) => {
    const metadata = row.source_metadata ?? {};
    return {
      id: row.id,
      ownerProjectId: row.job_id ?? row.lead_id,
      mediaType: row.media_type === "video" ? "video" : "image",
      mimeType: row.mime_type,
      originalFilename: row.original_filename,
      durationMs: row.duration_ms,
      capturedAt: row.captured_at,
      createdAt: row.created_at,
      creatorName: metadata.creator_name ?? null,
      description:
        typeof metadata.description === "string" ? metadata.description : null,
      tags: Array.isArray(metadata.tags)
        ? metadata.tags.filter((tag: unknown) => typeof tag === "string")
        : [],
      moveRevision: metadata.photo_move_revision ?? null,
      revision: metadata.photo_revision ?? null,
      trashRevision: metadata.photo_trash_revision ?? null,
    };
  });
}
