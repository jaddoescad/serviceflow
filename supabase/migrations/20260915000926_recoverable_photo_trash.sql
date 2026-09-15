-- ServiceFlow only. Keep original records/bytes for recovery. The existing
-- outbox carries metadata changes without turning trash into a hard delete.
create policy job_media_hide_trash on public.job_media as restrictive
  for select to authenticated
  using (source_metadata->>'photo_trashed_at' is null);

create or replace function private.set_photo_trash(
  requested_project_id uuid, requested_media_id uuid,
  requested_trashed boolean, expected_revision text, requested_revision uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  media public.job_media%rowtype;
  actor uuid := auth.uid();
  manager boolean := private.is_manager();
  current_revision text;
begin
  if actor is null or requested_trashed is null or requested_revision is null then
    raise exception 'Not permitted.' using errcode='42501';
  end if;
  select * into media from public.job_media
  where id=requested_media_id
    and (job_id=requested_project_id or lead_id=requested_project_id)
  for update;
  if not found then raise exception 'Photo not found.' using errcode='P0002'; end if;
  if not manager and (not requested_trashed or media.uploaded_by is distinct from actor
    or not exists(select 1 from public.employees where id=actor and is_active)) then
    raise exception 'Not permitted.' using errcode='42501';
  end if;
  current_revision:=media.source_metadata->>'photo_trash_revision';
  if current_revision=requested_revision::text
    and (media.source_metadata->>'photo_trashed_at' is not null)=requested_trashed then
    return media.source_metadata;
  end if;
  if current_revision is distinct from expected_revision
     or current_revision=requested_revision::text then
    raise exception 'Photo changed elsewhere. Reload before continuing.' using errcode='40001';
  end if;
  update public.job_media set source_metadata=source_metadata || jsonb_build_object(
    'photo_trashed_at',case when requested_trashed then clock_timestamp() else null end,
    'photo_trashed_by',case when requested_trashed then actor else null end,
    'photo_trash_revision',requested_revision,
    'photo_trash_changed_by',actor,'photo_trash_changed_at',clock_timestamp()),
    updated_at=clock_timestamp()
  where id=media.id returning source_metadata into media.source_metadata;
  return media.source_metadata;
end;
$$;
revoke all on function private.set_photo_trash(uuid,uuid,boolean,text,uuid) from public,anon;
grant execute on function private.set_photo_trash(uuid,uuid,boolean,text,uuid) to authenticated;
create or replace function public.set_photo_trash(
  requested_project_id uuid, requested_media_id uuid,
  requested_trashed boolean, expected_revision text, requested_revision uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_photo_trash(requested_project_id,requested_media_id,
    requested_trashed,expected_revision,requested_revision);
$$;
revoke all on function public.set_photo_trash(uuid,uuid,boolean,text,uuid) from public,anon;
grant execute on function public.set_photo_trash(uuid,uuid,boolean,text,uuid) to authenticated;

create or replace function private.get_photo_trash(
  requested_project_id uuid, requested_media_id uuid
) returns setof public.job_media language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_manager() then
    raise exception 'Only active managers can view trash.' using errcode='42501';
  end if;
  if requested_project_id is null and requested_media_id is null then
    raise exception 'Choose a project or photo.' using errcode='22023';
  end if;
  return query select * from public.job_media m
  where m.source_metadata->>'photo_trashed_at' is not null
    and (requested_project_id is null or m.job_id=requested_project_id or m.lead_id=requested_project_id)
    and (requested_media_id is null or m.id=requested_media_id)
  order by m.source_metadata->>'photo_trashed_at' desc,m.id;
end;
$$;
revoke all on function private.get_photo_trash(uuid,uuid) from public,anon;
grant execute on function private.get_photo_trash(uuid,uuid) to authenticated;
create or replace function public.get_photo_trash(
  requested_project_id uuid default null, requested_media_id uuid default null
) returns setof public.job_media language sql security invoker set search_path = '' as $$
  select * from private.get_photo_trash(requested_project_id,requested_media_id);
$$;
revoke all on function public.get_photo_trash(uuid,uuid) from public,anon;
grant execute on function public.get_photo_trash(uuid,uuid) to authenticated;

-- Direct DELETE privileges are retired only AFTER the compatible worker is
-- deployed. Never add an automatic purge or remove R2 files in this migration.
