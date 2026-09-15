create or replace function public.get_job_work_summary(calculated_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
with priced as (
 select t.job_id,t.job_name,t.started_at,t.id,
 (greatest(0,extract(epoch from(date_trunc('milliseconds',case when t.status='active' then calculated_at else coalesce(t.ended_at,calculated_at) end)-date_trunc('milliseconds',t.started_at)))/3600))::double precision as hours,
 r.hourly_rate_cents::double precision/100 as rate
 from public.time_entries t left join lateral (
  select hourly_rate_cents from public.employee_pay_rates r where r.employee_id=t.employee_id and r.effective_from <= (t.started_at at time zone 'UTC')::date order by r.effective_from desc limit 1
 ) r on true where t.job_id is not null
), work as (
 select job_id,sum(hours) as hours,coalesce(sum(hours*rate),0) as wages,coalesce(sum(hours) filter(where rate is null),0) as unpriced,max(started_at) as last_clock,
 (array_agg(job_name order by started_at desc,id))[1] as name from priced group by job_id
), assignments as(select job_id,count(*) as assigned from public.job_assignments where status='active' group by job_id)
select jsonb_build_object('calculatedAt',calculated_at,'rows',coalesce((select jsonb_agg(jsonb_build_object(
 'projectId',coalesce(w.job_id,a.job_id),'hours',coalesce(w.hours,0),'wages',coalesce(w.wages,0),'unpricedHours',coalesce(w.unpriced,0),
 'lastClockIn',w.last_clock,'name',w.name,'assignedCount',coalesce(a.assigned,0))) from work w full join assignments a on a.job_id=w.job_id),'[]'::jsonb));
$$;
revoke all on function public.get_job_work_summary(timestamptz) from public,anon;
grant execute on function public.get_job_work_summary(timestamptz) to authenticated;
