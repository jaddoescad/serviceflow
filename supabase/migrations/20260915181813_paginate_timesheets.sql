create or replace function public.get_timesheets_page(search_text text default '', employee_filter uuid default null, project_filter uuid default null, status_filter text default 'all', page_number integer default 1, calculated_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
with recent as materialized (
 select * from public.time_entries where started_at >= calculated_at - interval '90 days' or status='active'
), matched as materialized (
 select * from recent where (employee_filter is null or employee_id=employee_filter)
 and (project_filter is null or job_id=project_filter)
 and (status_filter='all' or status=case when status_filter='complete' then 'completed' else status_filter end)
 and (coalesce(search_text,'')='' or strpos(lower(coalesce(employee_name,'')||' '||coalesce(job_name,'')),lower(search_text))>0)
), totals as (
 select count(*) as total,coalesce(sum(greatest(0,extract(epoch from
 (date_trunc('milliseconds',case when status='active' then calculated_at else coalesce(ended_at,calculated_at) end)-date_trunc('milliseconds',started_at)))/3600)),0) as hours from matched
), page as (
 select * from matched order by started_at desc,id asc limit 50
 offset (least(greatest(coalesce(page_number,1),1),greatest(1,((select total from totals)+49)/50))-1)*50
)
select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page) order by started_at desc,id asc) from page),'[]'::jsonb),
 'total',(select total from totals),'totalHours',(select hours from totals),'activeCount',(select count(*) from recent where status='active'),'calculatedAt',calculated_at);
$$;
revoke all on function public.get_timesheets_page(text,uuid,uuid,text,integer,timestamptz) from public,anon;
grant execute on function public.get_timesheets_page(text,uuid,uuid,text,integer,timestamptz) to authenticated;
