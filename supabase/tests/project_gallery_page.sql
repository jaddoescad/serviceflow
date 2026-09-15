-- Execute inside BEGIN/ROLLBACK. No real project/media records are edited.
create temporary table gallery_fixture as select
  (select id from public.jobs limit 1) as project,
  (select id from public.employees where is_active and role='admin' limit 1) as actor,
  gen_random_uuid()::text as tag;
grant select on gallery_fixture to authenticated;
insert into public.job_media(id,job_id,object_key,media_type,mime_type,byte_size,uploaded_by,captured_at,created_at,source_metadata)
select photo,project,'jobs/'||project||'/'||photo||case when i%2=0 then '.jpg' else '.mp4' end,
  case when i%2=0 then 'image' else 'video' end,
  case when i%2=0 then 'image/jpeg' else 'video/mp4' end,
  1,actor,case when i%3=0 then null else '2026-09-14T04:00:00Z'::timestamptz end,
  '2026-09-14T04:00:00Z',jsonb_build_object('tags',jsonb_build_array(tag))
from gallery_fixture cross join lateral (select i,gen_random_uuid() as photo from generate_series(1,123) i) fixtures;
select set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) from gallery_fixture;
set local role authenticated;
do $$
declare
  f record; page jsonb; next_cursor jsonb; ids uuid[]:='{}'; ascending_ids uuid[]:='{}';
  entry jsonb; count_pages integer:=0;
begin
  select * into f from gallery_fixture;
  loop
    page:=public.project_gallery_page(f.project,requested_tag=>f.tag,cursor_at=>(next_cursor->>'at')::timestamptz,cursor_id=>(next_cursor->>'id')::uuid);
    if (page->>'total')::integer<>123 then raise exception 'Wrong total'; end if;
    for entry in select value from jsonb_array_elements(page->'items') loop
      if entry ? 'object_key' or entry ? 'source_metadata' then raise exception 'Internal fields leaked'; end if;
      ids:=array_append(ids,(entry->>'id')::uuid);
    end loop;
    count_pages:=count_pages+1;
    exit when not (page->>'hasMore')::boolean;
    next_cursor:=page->'cursor';
    if count_pages>4 then raise exception 'Cursor failed to advance'; end if;
  end loop;
  if cardinality(ids)<>123 or (select count(distinct id) from unnest(ids) id)<>123 or count_pages<>3 then
    raise exception 'Paging lost or duplicated rows';
  end if;
  next_cursor:=null;
  loop
    page:=public.project_gallery_page(f.project,requested_order=>'oldest',requested_tag=>f.tag,cursor_at=>(next_cursor->>'at')::timestamptz,cursor_id=>(next_cursor->>'id')::uuid);
    for entry in select value from jsonb_array_elements(page->'items') loop ascending_ids:=array_append(ascending_ids,(entry->>'id')::uuid); end loop;
    exit when not (page->>'hasMore')::boolean;
    next_cursor:=page->'cursor';
    if cardinality(ascending_ids)>123 then raise exception 'Ascending cursor failed'; end if;
  end loop;
  if ascending_ids<>(select array_agg(id order by position desc) from unnest(ids) with ordinality as t(id,position)) then raise exception 'Sort directions disagree'; end if;
  page:=public.project_gallery_page(f.project,requested_type=>'image',requested_tag=>f.tag);
  if (page->>'total')::integer<>61 then raise exception 'Type filter failed'; end if;
  page:=public.project_gallery_page(f.project,requested_tag=>f.tag,requested_from=>'2026-09-14',requested_to=>'2026-09-14');
  if (page->>'total')::integer<>123 then raise exception 'Local date/fallback filter failed'; end if;
  page:=public.project_gallery_page(f.project,requested_tag=>f.tag,requested_to=>'2026-09-13');
  if (page->>'total')::integer<>0 then raise exception 'End date boundary failed'; end if;
  page:=public.project_gallery_page(gen_random_uuid());
  if (page->>'total')::integer<>0 then raise exception 'Project filter failed'; end if;
  begin
    perform public.project_gallery_page(f.project,cursor_id=>gen_random_uuid());
    raise exception 'Invalid cursor accepted';
  exception when invalid_parameter_value then null; end;
end;
$$;
reset role;
select 'gallery paging, stable ordering, filtering and date boundaries passed' as result;
