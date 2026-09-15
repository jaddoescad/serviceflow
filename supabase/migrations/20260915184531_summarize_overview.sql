-- Read-only equivalent of computeDurations: clock bounds remain authoritative.
create or replace function public.admin_entry_durations(started timestamptz,ended timestamptz,entry_status text,segments jsonb,on_site boolean,calculated_at timestamptz)
returns table(total_ms double precision,on_site_ms double precision,off_site_ms double precision)
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare clock_start timestamptz:=date_trunc('milliseconds',started); clock_end timestamptz:=date_trunc('milliseconds',case when entry_status='active' then calculated_at else coalesce(ended,calculated_at) end);
 raw jsonb; part jsonb; n integer; i integer; part_start timestamptz; part_end timestamptz; start_text text; end_text text; duration double precision; segmented double precision; last_mode text:=case when on_site=false then 'off_site' else 'on_site' end;
begin
 total_ms:=greatest(0,extract(epoch from(clock_end-clock_start))*1000);on_site_ms:=0;off_site_ms:=0;
 raw:=case when jsonb_typeof(segments)='array' and jsonb_array_length(segments)>0 then segments else jsonb_build_array(jsonb_build_object('mode',last_mode,'startedAt',started,'endedAt',coalesce(ended,calculated_at))) end;
 n:=jsonb_array_length(raw);
 for i in 0..n-1 loop
  part:=raw->i;start_text:=coalesce(part->>'startedAt',started::text);end_text:=case when entry_status='active' and i=n-1 and jsonb_typeof(segments)='array' and jsonb_array_length(segments)>0 then calculated_at::text else coalesce(part->>'endedAt',ended::text,calculated_at::text) end;
  if not pg_input_is_valid(start_text,'timestamptz') or not pg_input_is_valid(end_text,'timestamptz') then continue;end if;
  part_start:=date_trunc('milliseconds',start_text::timestamptz);part_end:=date_trunc('milliseconds',end_text::timestamptz);
  duration:=greatest(0,extract(epoch from(least(part_end,clock_end)-greatest(part_start,clock_start)))*1000);
  last_mode:=coalesce(part->>'mode',last_mode);
  if part->>'mode'='off_site' then off_site_ms:=off_site_ms+duration;else on_site_ms:=on_site_ms+duration;end if;
 end loop;
 segmented:=on_site_ms+off_site_ms;
 if segmented>total_ms and segmented>0 then on_site_ms:=on_site_ms*total_ms/segmented;off_site_ms:=off_site_ms*total_ms/segmented;
 elsif segmented<total_ms then if last_mode='off_site' then off_site_ms:=off_site_ms+total_ms-segmented;else on_site_ms:=on_site_ms+total_ms-segmented;end if;end if;
 return next;
end;$$;
revoke all on function public.admin_entry_durations(timestamptz,timestamptz,text,jsonb,boolean,timestamptz) from public,anon;
grant execute on function public.admin_entry_durations(timestamptz,timestamptz,text,jsonb,boolean,timestamptz) to authenticated;

create or replace function public.get_overview_summary(calculated_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
with entries as materialized (
 select t.*,d.total_ms,d.on_site_ms,d.off_site_ms,(t.started_at at time zone 'America/Toronto')::date as day
 from public.time_entries t cross join lateral public.admin_entry_durations(t.started_at,t.ended_at,t.status,t.segments,t.is_on_site,calculated_at)d
 where t.started_at>=calculated_at-interval '720 hours' or t.status='active'
), compact as materialized(
 select id,employee_id as user_id,employee_name as user_name,job_name as project_name,started_at,ended_at,case when status='completed' then 'complete' else status end as status,last_distance_meters,day from entries
), activity_days as(select distinct day from entries order by day desc limit 7),
crew as(select e.id,coalesce(e.full_name,e.email,'Unknown') name,coalesce(sum(t.total_ms)/3600000,0) hours from public.employees e left join entries t on t.employee_id=e.id group by e.id,e.full_name,e.email),
project_work as(select job_id,sum(total_ms)/3600000 hours,max(started_at) last_activity,(array_agg(job_name order by started_at desc,id))[1] entry_name from entries where job_id is not null group by job_id),
project_names as(select w.*,case when j.is_feed_visible and not(coalesce(j.source,'')='legacy_companycam' and coalesce(j.contract_amount_cents,0)=0 and j.accepted_quote_id is null and j.id not in('38b6208e-12dd-5e62-b963-591a89868d91'::uuid,'99a4cb86-ec09-54c1-8a95-ffac416cf844'::uuid) and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(j.metadata->'labels')='array' then j.metadata->'labels' else '[]'::jsonb end)l where lower(btrim(coalesce(l->>'display_value',l->>'value',''))) in('lead','proposal sent'))) then j.name else w.entry_name end name from project_work w left join public.jobs j on j.id=w.job_id),
days as(select ((calculated_at-i*interval '24 hours') at time zone 'America/Toronto')::date as day from generate_series(0,13)i),
daily as(select d.day,coalesce(sum(e.on_site_ms)/3600000,0) onsite,coalesce(sum(e.off_site_ms)/3600000,0) offsite from days d left join entries e on e.day=d.day group by d.day)
select jsonb_build_object('calculatedAt',calculated_at,
 'hoursThisWeek',coalesce((select sum(total_ms)/3600000 from entries where started_at>=calculated_at-interval '168 hours' and started_at<calculated_at+interval '24 hours'),0),
 'hoursLastWeek',coalesce((select sum(total_ms)/3600000 from entries where started_at>=calculated_at-interval '336 hours' and started_at<calculated_at-interval '168 hours'),0),
 'activeCount',(select count(*) from entries where status='active'),'employeeCount',(select count(*) from public.employees),'activeEmployees',(select count(*) from public.employees where is_active),
 'onSitePct',coalesce((select floor(sum(on_site_ms)/nullif(sum(total_ms),0)*100+0.5) from entries),0),
 'dayData',(select jsonb_agg(jsonb_build_object('day',day,'onSite',floor(onsite*10+0.5)/10,'offSite',floor(offsite*10+0.5)/10,'total',floor((onsite+offsite)*10+0.5)/10) order by day) from daily),
 'topEmployees',coalesce((select jsonb_agg(jsonb_build_object('name',name,'hours',floor(hours*10+0.5)/10)) from(select * from crew where hours>0 order by hours desc,name collate "en-CA-x-icu",id limit 8)p),'[]'::jsonb),
 'topProjects',coalesce((select jsonb_agg(jsonb_build_object('name',btrim(name),'hours',floor(hours*10+0.5)/10)) from(select * from project_names where hours>0 and nullif(btrim(name),'') is not null order by last_activity desc,hours desc,name collate "en-CA-x-icu",job_id limit 8)p),'[]'::jsonb),
 'activeEntries',coalesce((select jsonb_agg(to_jsonb(c)-'day' order by started_at desc,id) from compact c where status='active'),'[]'::jsonb),
 'activityEntries',coalesce((select jsonb_agg(to_jsonb(c)-'day' order by started_at desc,id) from compact c where day in(select day from activity_days)),'[]'::jsonb),
 'offsiteEntries',coalesce((select jsonb_agg(to_jsonb(c)-'day') from(select * from compact where last_distance_meters>250 order by started_at desc,id limit 6)c),'[]'::jsonb));
$$;
revoke all on function public.get_overview_summary(timestamptz) from public,anon;
grant execute on function public.get_overview_summary(timestamptz) to authenticated;

create or replace function public.get_overview_movement(calculated_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select coalesce(jsonb_agg(to_jsonb(t) order by (status='active') desc,coalesce(ended_at,started_at) desc,id),'[]'::jsonb) from(
 select id,employee_id as user_id,employee_name as user_name,employee_email as user_email,job_id as companycam_project_id,job_name as project_name,job_address as project_address,client_entry_id,started_at,ended_at,case when status='completed' then 'complete' else status end status,clock_in_latitude,clock_in_longitude,last_distance_meters,is_on_site
 from public.time_entries where (started_at>=calculated_at-interval '720 hours' or status='active') and (status='active' or (started_at at time zone 'America/Toronto')::date=(calculated_at at time zone 'America/Toronto')::date or (ended_at at time zone 'America/Toronto')::date=(calculated_at at time zone 'America/Toronto')::date)
)t;
$$;
revoke all on function public.get_overview_movement(timestamptz) from public,anon;
grant execute on function public.get_overview_movement(timestamptz) to authenticated;
