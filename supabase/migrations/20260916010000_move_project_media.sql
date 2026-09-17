begin;

-- Preparation and commit use the same validation. R2 copying happens between
-- the two calls; commit rechecks ownership and lifecycle under row locks.
create function private.move_project_media(
 requested_media uuid, requested_source uuid, requested_destination uuid,
 expected_revision text, requested_revision uuid, commit_move boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 media public.job_media%rowtype;
 destination public.project_workspace%rowtype;
 target_key text;
 extension text;
 plan jsonb;
begin
 if auth.uid() is null or not private.is_manager() then
  raise exception 'Only active managers can move media.' using errcode='42501';
 end if;
 if requested_revision is null or requested_source is null or requested_destination is null or requested_source=requested_destination then
  raise exception 'Choose a different destination project.' using errcode='22023';
 end if;
 insert into public.project_workspace(project_id,job_id,lead_id)
 select id,case when kind='job' then id end,case when kind='lead' then id end
 from public.project_directory where id in (requested_source,requested_destination)
 order by id on conflict(project_id) do nothing;
 perform 1 from public.project_workspace where project_id in (requested_source,requested_destination) order by project_id for update;
 select * into media from public.job_media where id=requested_media for update;
 if not found then raise exception 'Media not found.' using errcode='P0002'; end if;
 if media.source_metadata->>'photo_move_revision'=requested_revision::text then
  if coalesce(media.job_id,media.lead_id)=requested_destination and media.source_metadata->>'photo_move_source'=requested_source::text then
   return jsonb_build_object('already_moved',true,'target_key',media.object_key);
  end if;
  raise exception 'Move request was already used.' using errcode='PT409';
 end if;
 if coalesce(media.job_id,media.lead_id) is distinct from requested_source
    or (media.source_metadata->>'photo_move_revision') is distinct from expected_revision then
  raise exception 'This media was moved elsewhere. Refresh and try again.' using errcode='PT409';
 end if;
 if media.source_metadata->>'photo_trashed_at' is not null
    or exists(select 1 from public.project_workspace where project_id=requested_source and trashed_at is not null) then
  raise exception 'Restore media and its project before moving it.' using errcode='22023';
 end if;
 select * into destination from public.project_workspace where project_id=requested_destination and archived_at is null and trashed_at is null;
 if not found then raise exception 'Choose an active destination project.' using errcode='22023'; end if;
 extension := case media.mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/heic' then 'heic' when 'image/heif' then 'heif' when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' end;
 if extension is null then raise exception 'Unsupported media type.' using errcode='22023'; end if;
 target_key := case when destination.job_id is not null then 'jobs/' else 'leads/' end || requested_destination::text || '/' || media.id::text || '~' || requested_revision::text || '.' || extension;
 plan := jsonb_build_object('already_moved',false,'source_key',media.object_key,'target_key',target_key,'byte_size',media.byte_size,'mime_type',media.mime_type,'media_type',media.media_type);
 if commit_move then
  update public.job_media set job_id=destination.job_id, lead_id=destination.lead_id, object_key=target_key,
   source_metadata=source_metadata || jsonb_build_object('photo_move_revision',requested_revision,'photo_move_source',requested_source,'photo_moved_by',auth.uid(),'photo_moved_at',clock_timestamp()),
   updated_at=clock_timestamp()
  where id=media.id;
 end if;
 return plan;
end $$;
revoke all on function private.move_project_media(uuid,uuid,uuid,text,uuid,boolean) from public,anon;
grant execute on function private.move_project_media(uuid,uuid,uuid,text,uuid,boolean) to authenticated;
create function public.move_project_media(
 requested_media uuid, requested_source uuid, requested_destination uuid,
 expected_revision text, requested_revision uuid, commit_move boolean default false
) returns jsonb language sql security invoker set search_path='' as $$
 select private.move_project_media(requested_media,requested_source,requested_destination,expected_revision,requested_revision,commit_move);
$$;
revoke all on function public.move_project_media(uuid,uuid,uuid,text,uuid,boolean) from public,anon;
grant execute on function public.move_project_media(uuid,uuid,uuid,text,uuid,boolean) to authenticated;
commit;
