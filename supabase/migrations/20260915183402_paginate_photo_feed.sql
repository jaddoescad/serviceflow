create or replace view public.admin_photo_feed with (security_invoker=true) as
select m.id,coalesce(m.job_id,m.lead_id) as owner_id,case when m.job_id is not null then 'job' else 'lead' end as owner_kind,
case when m.job_id is not null then coalesce(nullif(btrim(j.name),''),'Unnamed job') else coalesce(nullif(btrim(c.name),''),'Unnamed lead') end as project_name,
case when m.job_id is not null then coalesce(nullif(btrim(j.formatted_address),''),nullif(btrim(j.address_line_1),''))
 else coalesce(case when lower(btrim(l.address)) not in ('ca','canada') then nullif(btrim(l.address),'') end,nullif(concat_ws(', ',nullif(btrim(l.city),''),nullif(btrim(l.province),''),nullif(btrim(l.postal_code),'')),'')) end as address,
case when m.media_type='video' then 'video' else 'image' end as media_type,coalesce(nullif(btrim(m.mime_type),''),'image/jpeg') as mime_type,m.duration_ms,
coalesce(m.captured_at,m.created_at) as display_at,m.captured_at,m.created_at,
coalesce(nullif(btrim(m.source_metadata->>'creator_name'),''),nullif(btrim(e.full_name),''),nullif(btrim(e.email),''),'Ottawa Painters') as creator_name,
nullif(btrim(m.source_metadata->>'description'),'') as description
from public.job_media m left join public.jobs j on j.id=m.job_id left join public.leads l on l.id=m.lead_id left join public.contacts c on c.id=l.contact_id left join public.employees e on e.id=m.uploaded_by
where coalesce(m.job_id,m.lead_id) is not null and coalesce(m.captured_at,m.created_at) is not null;
revoke all on public.admin_photo_feed from public,anon;
grant select on public.admin_photo_feed to authenticated;

create or replace function public.get_photo_feed_page(project_filter uuid default null, creator_filter text default null, media_filter text default null, since_filter timestamptz default null, after_cursor jsonb default null)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
with batch as materialized (
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
 'nextCursor',case when (select count(*) from batch)>60 then (select jsonb_build_object('capturedAt',captured_at,'createdAt',created_at,'id',id) from page order by captured_at asc nulls first,created_at asc,id asc limit 1) end);
$$;
revoke all on function public.get_photo_feed_page(uuid,text,text,timestamptz,jsonb) from public,anon;
grant execute on function public.get_photo_feed_page(uuid,text,text,timestamptz,jsonb) to authenticated;

create or replace function public.get_photo_feed_summary(project_filter uuid default null, creator_filter text default null, media_filter text default null, since_filter timestamptz default null, include_options boolean default true)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select jsonb_build_object('total',(select count(*) from public.admin_photo_feed p where (project_filter is null or p.owner_id=project_filter) and (creator_filter is null or p.creator_name=creator_filter) and (media_filter is null or p.media_type=media_filter) and (since_filter is null or p.display_at>=since_filter)),
'projects',case when include_options then coalesce((select jsonb_agg(jsonb_build_array(owner_id,project_name) order by project_name collate "en-CA-x-icu",owner_id) from (select distinct owner_id,project_name from public.admin_photo_feed)p),'[]'::jsonb) end,
'creators',case when include_options then coalesce((select jsonb_agg(jsonb_build_array(creator_name,n) order by creator_name collate "en-CA-x-icu") from(select creator_name,count(*) n from public.admin_photo_feed group by creator_name)p),'[]'::jsonb) end);
$$;
revoke all on function public.get_photo_feed_summary(uuid,text,text,timestamptz,boolean) from public,anon;
grant execute on function public.get_photo_feed_summary(uuid,text,text,timestamptz,boolean) to authenticated;
