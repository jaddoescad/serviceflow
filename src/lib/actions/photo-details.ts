"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ProjectMediaItem } from "@/lib/project-data";

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

export async function loadPhotoTrash(projectId:string):Promise<{items:ProjectMediaItem[];error?:string}> {
  await requireStaff();
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('get_photo_trash',{requested_project_id:projectId});
  if(error)return {items:[],error:'Could not load trash. Please try again.'};
  return {items:(data??[]).map((row:any)=>({
    id:row.id,mediaType:row.media_type==='video'?'video':'image',mimeType:row.mime_type,
    originalFilename:row.original_filename,durationMs:row.duration_ms,capturedAt:row.captured_at,
    createdAt:row.created_at,creatorName:row.source_metadata?.creator_name??null,
    description:row.source_metadata?.description??null,tags:row.source_metadata?.tags??[],
    revision:row.source_metadata?.photo_revision??null,trashRevision:row.source_metadata?.photo_trash_revision??null,
  }))};
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
