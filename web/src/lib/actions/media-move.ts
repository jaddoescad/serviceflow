"use server";

import { requireStaff, getSessionToken } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { validPhotoId } from "@/lib/photo-link";

export async function findMediaDestinations(query: string) {
  await requireStaff();
  const client = await createClient();
  const { data, error } = await client
    .from("project_directory")
    .select("id,name,address")
    .is("archived_at", null)
    .is("trashed_at", null)
    .ilike(
      "name",
      `%${query
        .trim()
        .slice(0, 120)
        .replace(/[\\%_]/g, "\\$&")}%`,
    )
    .order("updated_at", { ascending: false })
    .limit(25);
  if (error) throw new Error("Could not find projects.");
  return data as { id: string; name: string; address: string | null }[];
}

export async function moveSelectedPhoto(input: {
  mediaId: string;
  sourceId: string;
  destinationId: string;
  expectedRevision: string | null;
  revision: string;
}) {
  await requireStaff();
  if (
    ![input.mediaId, input.sourceId, input.destinationId, input.revision].every(
      validPhotoId,
    )
  )
    return { ok: false, error: "Invalid move request." };
  const token = await getSessionToken();
  if (!token) return { ok: false, error: "Sign in again to move media." };
  const base =
    process.env.PROJECT_MEDIA_API_URL ||
    "https://project-media-worker.jadslim-fai.workers.dev";
  try {
    const response = await fetch(
      `${base.replace(/\/$/, "")}/v1/media/${input.mediaId}/move`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
        cache: "no-store",
        signal: AbortSignal.timeout(120000),
      },
    );
    const result = await response.json();
    if (!response.ok)
      return {
        ok: false,
        error: result.error || "Could not move this media. Retry safely.",
      };
    for (const path of [
      "/photos",
      "/projects",
      `/jobs/${input.sourceId}`,
      `/jobs/${input.destinationId}`,
    ])
      revalidatePath(path);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Could not confirm this move. Retry to check safely.",
    };
  }
}
