-- ServiceFlow only. Existing metadata sync carries these fields to the
-- accounting copy; no destination editing privilege is granted.
create or replace function private.edit_photo_details(
  requested_project_id uuid, requested_media_id uuid,
  expected_revision text, requested_revision uuid,
  requested_description text, requested_tags text[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  media public.job_media%rowtype;
  clean_description text := btrim(coalesce(requested_description, ''));
  clean_tags text[];
  current_revision text;
begin
  if auth.uid() is null or not private.is_manager() then
    raise exception 'Only active managers can edit photo details.' using errcode = '42501';
  end if;
  if requested_revision is null or length(clean_description) > 10000
     or coalesce(cardinality(requested_tags), 0) > 30
     or exists (select 1 from unnest(requested_tags) t where length(btrim(t)) > 60) then
    raise exception 'Invalid photo details.' using errcode = '22023';
  end if;
  select coalesce(array_agg(tag order by tag), array[]::text[]) into clean_tags
  from (select distinct btrim(t) as tag from unnest(requested_tags) t
        where nullif(btrim(t), '') is not null) tags;

  select * into media from public.job_media
  where id = requested_media_id
    and (job_id = requested_project_id or lead_id = requested_project_id)
  for update;
  if not found then
    raise exception 'Photo not found.' using errcode = 'P0002';
  end if;
  current_revision := media.source_metadata->>'photo_revision';
  -- A retry after a lost response may return the committed result, but may
  -- never reuse a revision to silently submit different content.
  if current_revision = requested_revision::text
     and media.source_metadata->>'description' = clean_description
     and media.source_metadata->'tags' = to_jsonb(clean_tags) then
    return media.source_metadata;
  end if;
  if current_revision is distinct from expected_revision
     or current_revision = requested_revision::text then
    raise exception 'Photo changed elsewhere. Reload before saving.' using errcode = '40001';
  end if;
  update public.job_media set
    source_metadata = source_metadata || jsonb_build_object(
      'description', clean_description, 'tags', clean_tags,
      'photo_revision', requested_revision,
      'photo_edited_by', auth.uid(), 'photo_edited_at', clock_timestamp()),
    updated_at = clock_timestamp()
  where id = media.id returning source_metadata into media.source_metadata;
  return media.source_metadata;
end;
$$;
revoke all on function private.edit_photo_details(uuid,uuid,text,uuid,text,text[]) from public, anon;
grant execute on function private.edit_photo_details(uuid,uuid,text,uuid,text,text[]) to authenticated;

create or replace function public.edit_photo_details(
  requested_project_id uuid, requested_media_id uuid,
  expected_revision text, requested_revision uuid,
  requested_description text, requested_tags text[]
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.edit_photo_details(requested_project_id, requested_media_id,
    expected_revision, requested_revision, requested_description, requested_tags);
$$;
revoke all on function public.edit_photo_details(uuid,uuid,text,uuid,text,text[]) from public, anon;
grant execute on function public.edit_photo_details(uuid,uuid,text,uuid,text,text[]) to authenticated;
