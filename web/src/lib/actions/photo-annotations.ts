"use server";

import {revalidatePath} from 'next/cache';
import {requireStaff} from '@/lib/auth';
import {createClient} from '@/lib/supabase/server';
import {annotationDocumentSchema,type AnnotationDocument} from '@/lib/photo-annotations';
import {validPhotoId} from '@/lib/photo-link';

export async function loadPhotoAnnotations(projectId:string,mediaId:string):Promise<{
  ok:true;document:AnnotationDocument;revision:string|null;
}|{ok:false;error:string}> {
  if(!validPhotoId(projectId)||!validPhotoId(mediaId))return {ok:false,error:'Invalid photo.'};
  await requireStaff();
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('get_photo_annotations',{requested_project_id:projectId,requested_media_id:mediaId});
  if(error)return {ok:false,error:'Could not load drawings. Please retry.'};
  if(!data)return {ok:false,error:'Photo unavailable.'};
  const parsed=annotationDocumentSchema.safeParse(data.document);
  if(!parsed.success)return {ok:false,error:'This drawing format cannot be opened.'};
  return {ok:true,document:parsed.data,revision:data.revision};
}

export async function savePhotoAnnotations(input:{projectId:string;mediaId:string;expectedRevision:string|null;revision:string;document:AnnotationDocument}):Promise<{
  ok:true;revision:string;document:AnnotationDocument;
}|{ok:false;error:string;conflict:boolean}> {
  await requireStaff();
  const parsed=annotationDocumentSchema.safeParse(input.document);
  if(!parsed.success||![input.projectId,input.mediaId,input.revision].every(validPhotoId))
    return {ok:false,error:'Invalid drawing. Check the shapes and try again.',conflict:false};
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('save_photo_annotations',{
    requested_project_id:input.projectId,requested_media_id:input.mediaId,expected_revision:input.expectedRevision,
    requested_revision:input.revision,requested_document:parsed.data,
  });
  if(error)return {ok:false,conflict:error.code==='PT409',error:error.code==='PT409'
    ?'This photo’s drawings changed elsewhere. Keep your draft and reload to review them.'
    :'Could not save drawings. Retry to check safely.'};
  revalidatePath(`/jobs/${input.projectId}`);
  return {ok:true,revision:data.revision,document:data.document};
}
