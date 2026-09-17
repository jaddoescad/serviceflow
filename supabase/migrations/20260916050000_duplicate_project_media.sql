begin;
-- The worker copies bytes between prepare and commit. Both calls validate the
-- original's current project/key; commit never changes the original record.
create function public.duplicate_project_media(
  requested_media uuid, requested_copy uuid, requested_project uuid,
  expected_key text, requested_attempt uuid, commit_copy boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  original public.job_media%rowtype;
  existing public.job_media%rowtype;
  target_key text;
  extension text;
  plan jsonb;
begin
  if auth.uid() is null or not private.is_manager() then
    raise exception 'Only active managers can duplicate media.' using errcode = '42501';
  end if;
  if requested_copy is null or requested_copy = requested_media or requested_project is null or requested_attempt is null then
    raise exception 'Invalid duplicate request.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(requested_copy::text, 0));
  select * into existing from public.job_media where id = requested_copy;
  if found then
    if existing.source_metadata->>'duplicated_from' = requested_media::text
      and existing.source_metadata->>'duplicated_by' = auth.uid()::text then
      return jsonb_build_object('already_copied', true, 'id', existing.id);
    end if;
    raise exception 'Duplicate request was already used.' using errcode = 'PT409';
  end if;
  insert into public.project_workspace(project_id,job_id,lead_id)
    select id, case when kind='job' then id end, case when kind='lead' then id end
    from public.project_directory where id=requested_project
    on conflict(project_id) do nothing;
  perform 1 from public.project_workspace where project_id=requested_project and trashed_at is null for update;
  if not found then raise exception 'Restore the project before duplicating photos.' using errcode='22023'; end if;
  select * into original from public.job_media where id=requested_media for update;
  if not found then raise exception 'Photo not found.' using errcode='P0002'; end if;
  if coalesce(original.job_id, original.lead_id) is distinct from requested_project
    or original.object_key is distinct from expected_key then
    raise exception 'Photo changed. Refresh before duplicating it.' using errcode='PT409';
  end if;
  if original.media_type <> 'image' or original.source_metadata->>'photo_trashed_at' is not null then
    raise exception 'Choose an available photo.' using errcode='22023';
  end if;
  extension := case original.mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'image/webp' then 'webp' when 'image/heic' then 'heic' when 'image/heif' then 'heif' end;
  if extension is null then raise exception 'Unsupported image type.' using errcode='22023'; end if;
  target_key := case when original.job_id is not null then 'jobs/' else 'leads/' end
    || requested_project::text || '/' || requested_copy::text || '~' || requested_attempt::text || '.' || extension;
  plan := jsonb_build_object('already_copied',false,'id',requested_copy,
    'source_key',original.object_key,'target_key',target_key,
    'byte_size',original.byte_size,'mime_type',original.mime_type,'media_type','image');
  if commit_copy then
    insert into public.job_media(id,job_id,lead_id,object_key,media_type,mime_type,original_filename,
      byte_size,width,height,captured_at,uploaded_by,source_provider,source_metadata)
    values(requested_copy,original.job_id,original.lead_id,target_key,'image',original.mime_type,original.original_filename,
      original.byte_size,original.width,original.height,original.captured_at,original.uploaded_by,'app',
      (original.source_metadata - array['photo_move_revision','photo_move_source','photo_moved_by','photo_moved_at'])
      || jsonb_build_object('duplicated_from',original.id,'duplicated_by',auth.uid(),'duplicated_at',clock_timestamp()));
  end if;
  return plan;
end;
$$;
revoke all on function public.duplicate_project_media(uuid,uuid,uuid,text,uuid,boolean) from public,anon;
grant execute on function public.duplicate_project_media(uuid,uuid,uuid,text,uuid,boolean) to authenticated;
commit;
