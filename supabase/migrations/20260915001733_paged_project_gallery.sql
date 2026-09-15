-- ServiceFlow gallery paging. RLS remains the authority for every row.
create index if not exists job_media_gallery_job_order_idx
  on public.job_media(job_id,(coalesce(captured_at,created_at)),id);
create index if not exists job_media_gallery_lead_order_idx
  on public.job_media(lead_id,(coalesce(captured_at,created_at)),id);

create or replace function public.project_gallery_page(
  requested_project_id uuid,
  requested_type text default 'all', requested_order text default 'newest',
  requested_creator text default null, requested_tag text default null,
  requested_from date default null, requested_to date default null,
  cursor_at timestamptz default null, cursor_id uuid default null,
  requested_limit integer default 48
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in.' using errcode='42501'; end if;
  if requested_project_id is null or requested_type is null or requested_type not in ('all','image','video')
     or requested_order is null or requested_order not in ('newest','oldest')
     or requested_limit is null or requested_limit<1 or requested_limit>100
     or (cursor_at is null) <> (cursor_id is null)
     or requested_from>requested_to then
    raise exception 'Invalid gallery query.' using errcode='22023';
  end if;
  with filtered as materialized (
    select m.id,coalesce(m.captured_at,m.created_at) as taken_at
    from public.job_media m left join public.employees e on e.id=m.uploaded_by
    where (m.job_id=requested_project_id or m.lead_id=requested_project_id)
      and m.source_metadata->>'photo_trashed_at' is null
      and (requested_type='all' or m.media_type=requested_type)
      and (requested_creator is null or coalesce(nullif(m.source_metadata->>'creator_name',''),e.full_name)=requested_creator)
      and (requested_tag is null or m.source_metadata->'tags' ? requested_tag)
      and (requested_from is null or coalesce(m.captured_at,m.created_at)>=requested_from::timestamp at time zone 'America/Toronto')
      and (requested_to is null or coalesce(m.captured_at,m.created_at)<(requested_to+1)::timestamp at time zone 'America/Toronto')
  ), page_ids as (
    select * from filtered
    where cursor_at is null
      or (requested_order='newest' and (taken_at,id)<(cursor_at,cursor_id))
      or (requested_order='oldest' and (taken_at,id)>(cursor_at,cursor_id))
    order by case when requested_order='newest' then taken_at end desc,
      case when requested_order='newest' then id end desc,
      case when requested_order='oldest' then taken_at end,
      case when requested_order='oldest' then id end
    limit requested_limit+1
  ), numbered as (
    select p.*,row_number() over(order by
      case when requested_order='newest' then taken_at end desc,
      case when requested_order='newest' then id end desc,
      case when requested_order='oldest' then taken_at end,
      case when requested_order='oldest' then id end) as position from page_ids p
  ), items as (
    select n.position,jsonb_build_object(
      'id',m.id,'mediaType',m.media_type,'mimeType',m.mime_type,
      'originalFilename',m.original_filename,'durationMs',m.duration_ms,
      'capturedAt',m.captured_at,'createdAt',m.created_at,
      'creatorName',coalesce(nullif(m.source_metadata->>'creator_name',''),e.full_name),
      'description',m.source_metadata->>'description',
      'tags',coalesce((select jsonb_agg(value) from jsonb_array_elements(case when jsonb_typeof(m.source_metadata->'tags')='array' then m.source_metadata->'tags' else '[]'::jsonb end) where jsonb_typeof(value)='string'),'[]'::jsonb),
      'revision',m.source_metadata->>'photo_revision',
      'trashRevision',m.source_metadata->>'photo_trash_revision'
    ) as item from numbered n join public.job_media m on m.id=n.id
    left join public.employees e on e.id=m.uploaded_by where n.position<=requested_limit
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(item order by position) from items),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'hasMore',(select count(*)>requested_limit from page_ids),
    'cursor',(select jsonb_build_object('at',taken_at,'id',id) from numbered where position=requested_limit),
    'options',case when cursor_at is null then jsonb_build_object(
      'creators',coalesce((select jsonb_agg(name order by name) from (
        select distinct coalesce(nullif(m.source_metadata->>'creator_name',''),e.full_name) as name
        from public.job_media m left join public.employees e on e.id=m.uploaded_by
        where (m.job_id=requested_project_id or m.lead_id=requested_project_id)
          and m.source_metadata->>'photo_trashed_at' is null
      ) names where name is not null),'[]'::jsonb),
      'tags',coalesce((select jsonb_agg(tag order by tag) from (
        select distinct value #>> '{}' as tag from public.job_media m
        cross join lateral jsonb_array_elements(case when jsonb_typeof(m.source_metadata->'tags')='array' then m.source_metadata->'tags' else '[]'::jsonb end)
        where (m.job_id=requested_project_id or m.lead_id=requested_project_id)
          and m.source_metadata->>'photo_trashed_at' is null and jsonb_typeof(value)='string'
      ) tags),'[]'::jsonb)
    ) else null end
  ) into result;
  return result;
end;
$$;
revoke all on function public.project_gallery_page(uuid,text,text,text,text,date,date,timestamptz,uuid,integer) from public,anon;
grant execute on function public.project_gallery_page(uuid,text,text,text,text,date,date,timestamptz,uuid,integer) to authenticated;
