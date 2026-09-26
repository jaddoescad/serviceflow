"use server";

import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { validPhotoId } from "@/lib/photo-link";

export async function setProjectCover(projectId: string, mediaId: string) {
  await requireStaff();
  if (!validPhotoId(projectId) || !validPhotoId(mediaId))
    return { error: "Invalid photo." };
  const client = await createClient();
  const { error } = await client.rpc("set_project_cover", {
    requested_project: projectId,
    requested_media: mediaId,
  });
  if (error)
    return {
      error:
        "Could not set the cover. Choose an available photo from this project and try again.",
    };
  revalidatePath("/projects");
  revalidatePath(`/jobs/${projectId}`);
  return { error: null };
}
