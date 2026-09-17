"use server";

import { requireStaff, getSessionToken } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { validPhotoId } from "@/lib/photo-link";
import { revalidatePath } from "next/cache";

export async function duplicatePhoto(input: {
  mediaId: string;
  projectId: string;
  copyId: string;
}) {
  await requireStaff();
  if (![input.mediaId, input.projectId, input.copyId].every(validPhotoId))
    return { ok: false, error: "Invalid duplicate request." };
  const client = await createClient();
  const { data: original, error } = await client
    .from("job_media")
    .select("object_key")
    .eq("id", input.mediaId)
    .maybeSingle();
  if (error || !original)
    return {
      ok: false,
      error: "Photo is no longer available. Refresh and try again.",
    };
  const token = await getSessionToken();
  if (!token) return { ok: false, error: "Sign in again to duplicate photos." };
  const base =
    process.env.PROJECT_MEDIA_API_URL ||
    "https://project-media-worker.jadslim-fai.workers.dev";
  try {
    const response = await fetch(
      `${base.replace(/\/$/, "")}/v1/media/${input.mediaId}/duplicate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceId: input.projectId,
          copyId: input.copyId,
          expectedKey: original.object_key,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(120000),
      },
    );
    const result = await response.json();
    if (!response.ok)
      return {
        ok: false,
        error: result.error || "Could not duplicate this photo. Retry safely.",
      };
    for (const path of ["/photos", "/projects", `/jobs/${input.projectId}`])
      revalidatePath(path);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Could not confirm this copy. Retry to check safely.",
    };
  }
}
