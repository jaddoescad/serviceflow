create or replace function public.get_crew_summary(calculated_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
with work as (
 select employee_id,sum(greatest(0,extract(epoch from(date_trunc('milliseconds',case when status='active' then calculated_at else coalesce(ended_at,calculated_at) end)-date_trunc('milliseconds',started_at)))/3600))::double precision hours,max(started_at) last_activity
 from public.time_entries where started_at>=calculated_at-interval '720 hours' or status='active' group by employee_id
), assigned as(select employee_id,count(*) n from public.job_assignments where status='active' group by employee_id)
select coalesce(jsonb_agg(jsonb_build_object('userId',e.id,'name',coalesce(e.full_name,e.email,'Unknown'),'email',e.email,'role',e.role,'isActive',e.is_active,
'loggedHours',coalesce(w.hours,0),'lastActivity',w.last_activity,'assignedCount',coalesce(a.n,0),'currentPayRate',r.hourly_rate_cents::double precision/100) order by e.full_name nulls last,e.id),'[]'::jsonb)
from public.employees e left join work w on w.employee_id=e.id left join assigned a on a.employee_id=e.id left join lateral(select hourly_rate_cents from public.employee_pay_rates r where r.employee_id=e.id and r.effective_from<=(calculated_at at time zone 'UTC')::date order by effective_from desc limit 1)r on true;
$$;
revoke all on function public.get_crew_summary(timestamptz) from public,anon;
grant execute on function public.get_crew_summary(timestamptz) to authenticated;

create or replace function public.get_crew_pay_history(employee uuid)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',employee_id,'hourly_rate',hourly_rate_cents::double precision/100,'effective_from',effective_from) order by effective_from desc),'[]'::jsonb) from public.employee_pay_rates where employee_id=employee;
$$;
revoke all on function public.get_crew_pay_history(uuid) from public,anon;
grant execute on function public.get_crew_pay_history(uuid) to authenticated;
