"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function setPhotoTrash(input: {projectId:string;mediaId:string;trashed:boolean;expectedRevision:string|null;revision:string}) {
  await requireStaff();
  const supabase=await createClient();
  const {error}=await supabase.rpc('set_photo_trash',{
    requested_project_id:input.projectId,requested_media_id:input.mediaId,
    requested_trashed:input.trashed,expected_revision:input.expectedRevision,requested_revision:input.revision,
  });
  if(error)return {ok:false,error:['40001','PT409'].includes(error.code)?'This photo changed elsewhere. Reload before continuing.':'Could not update photo trash. Please try again.'};
  revalidatePath(`/jobs/${input.projectId}`);
  return {ok:true};
}

export async function savePhotoDetails(input: {
  projectId: string;
  mediaId: string;
  expectedRevision: string | null;
  revision: string;
  description: string;
  tags: string[];
}): Promise<{ ok: true; revision: string; description: string; tags: string[] } | { ok: false; error: string; conflict: boolean }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("edit_photo_details", {
    requested_project_id: input.projectId,
    requested_media_id: input.mediaId,
    expected_revision: input.expectedRevision,
    requested_revision: input.revision,
    requested_description: input.description,
    requested_tags: input.tags,
  });
  if (error) return {
    ok: false,
    conflict: ["40001", "PT409"].includes(error.code),
    error: ["40001", "PT409"].includes(error.code) ? "This photo was edited elsewhere. Reload to review the latest details before saving." : "Could not save photo details. Please try again.",
  };
  revalidatePath(`/jobs/${input.projectId}`);
  return { ok: true, revision: data.photo_revision, description: data.description, tags: data.tags };
}
