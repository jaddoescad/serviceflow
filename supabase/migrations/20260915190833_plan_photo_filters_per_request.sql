-- Generic optional-filter plans scanned far more rows than the literal-filter query (175 ms vs 5 ms).
create or replace function public.get_photo_feed_page(project_filter uuid default null, creator_filter text default null, media_filter text default null, since_filter timestamptz default null, after_cursor jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp set plan_cache_mode=force_custom_plan as $$
begin
return (with batch as materialized (
 select * from public.admin_photo_feed p
 where (project_filter is null or p.owner_id=project_filter) and (creator_filter is null or p.creator_name=creator_filter)
 and (media_filter is null or p.media_type=media_filter) and (since_filter is null or p.display_at>=since_filter)
 and (after_cursor is null or
  (coalesce(p.captured_at,'-infinity'::timestamptz),p.created_at,p.id) <
  (coalesce((after_cursor->>'capturedAt')::timestamptz,'-infinity'::timestamptz),(after_cursor->>'createdAt')::timestamptz,(after_cursor->>'id')::uuid))
 order by p.captured_at desc nulls last,p.created_at desc,p.id desc limit 61
), page as materialized(select * from batch order by captured_at desc nulls last,created_at desc,id desc limit 60)
select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',id,'ownerProjectId',owner_id,'ownerKind',owner_kind,'projectName',project_name,'address',address,'mediaType',media_type,'mimeType',mime_type,'durationMs',duration_ms,'capturedAt',display_at,'creatorName',creator_name,'description',description
 ) order by captured_at desc nulls last,created_at desc,id desc) from page),'[]'::jsonb),
 'nextCursor',case when (select count(*) from batch)>60 then (select jsonb_build_object('capturedAt',captured_at,'createdAt',created_at,'id',id) from page order by captured_at asc nulls first,created_at asc,id asc limit 1) end));
end;
$$;
create or replace function public.get_photo_feed_summary(project_filter uuid default null, creator_filter text default null, media_filter text default null, since_filter timestamptz default null, include_options boolean default true)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp set plan_cache_mode=force_custom_plan as $$
begin
return (select jsonb_build_object('total',(select count(*) from public.admin_photo_feed p where (project_filter is null or p.owner_id=project_filter) and (creator_filter is null or p.creator_name=creator_filter) and (media_filter is null or p.media_type=media_filter) and (since_filter is null or p.display_at>=since_filter)),
'projects',case when include_options then coalesce((select jsonb_agg(jsonb_build_array(owner_id,project_name) order by project_name collate "en-CA-x-icu",owner_id) from (select distinct owner_id,project_name from public.admin_photo_feed)p),'[]'::jsonb) end,
'creators',case when include_options then coalesce((select jsonb_agg(jsonb_build_array(creator_name,n) order by creator_name collate "en-CA-x-icu") from(select creator_name,count(*) n from public.admin_photo_feed group by creator_name)p),'[]'::jsonb) end));
end;
$$;
