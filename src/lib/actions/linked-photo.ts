"use server";

import {requireStaff} from '@/lib/auth';
import {createClient} from '@/lib/supabase/server';
import {validPhotoId} from '@/lib/photo-link';
import type {ProjectMediaItem} from '@/lib/project-data';

/** An original ID is a locator, not permission: project binding and RLS still apply. */
export async function loadLinkedPhoto(projectId:string,mediaId:string):Promise<ProjectMediaItem|null> {
  if(!validPhotoId(projectId)||!validPhotoId(mediaId))return null;
  await requireStaff();
  const supabase=await createClient();
  const {data:row,error}=await supabase.from('job_media')
    .select('id,media_type,mime_type,original_filename,duration_ms,captured_at,created_at,source_metadata')
    .eq('id',mediaId).or(`job_id.eq.${projectId},lead_id.eq.${projectId}`).maybeSingle();
  if(error)throw new Error('Could not load photo.');
  if(!row)return null;
  const metadata=row.source_metadata??{};
  return {
    id:row.id,mediaType:row.media_type==='video'?'video':'image',mimeType:row.mime_type,
    originalFilename:row.original_filename,durationMs:row.duration_ms,capturedAt:row.captured_at,
    createdAt:row.created_at,creatorName:typeof metadata.creator_name==='string'?metadata.creator_name:null,
    description:typeof metadata.description==='string'?metadata.description:null,
    tags:Array.isArray(metadata.tags)?metadata.tags.filter((tag:unknown)=>typeof tag==='string'):[],
    revision:typeof metadata.photo_revision==='string'?metadata.photo_revision:null,
    trashRevision:typeof metadata.photo_trash_revision==='string'?metadata.photo_trash_revision:null,
  };
}
