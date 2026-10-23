-- Painters without a pay rate count at $30 an hour in budget hours, the rate
-- new painters are given. Before, they counted one for one at the job's rate.
create or replace view public.job_feed with (security_invoker = true) as
select
  job.id,
  job.name,
  job.status,
  job.formatted_address,
  job.address_line_1,
  job.address_line_2,
  job.city,
  job.province,
  job.postal_code,
  job.country,
  job.latitude,
  job.longitude,
  job.companycam_project_ids,
  job.scheduled_on,
  job.started_on,
  job.completed_on,
  job.is_feed_visible,
  job.updated_at,
  budget.budget_minutes,
  usage.used_minutes,
  case
    when budget.budget_minutes is null or budget.budget_minutes = 0 then null::numeric
    else round(usage.used_minutes::numeric / budget.budget_minutes::numeric * 100::numeric, 2)
  end as budget_percent_used,
  case
    when budget.budget_minutes is null then 'not_configured'::text
    when usage.used_minutes > budget.budget_minutes then 'over_budget'::text
    when job.status = 'completed'::text then 'complete'::text
    else 'active'::text
  end as budget_status,
  job.lead_id,
  job.org_id,
  rate.budget_hourly_rate_cents
from public.jobs job
left join lateral (
  select
    source.budget_minutes,
    coalesce(source.hourly_rate_cents, nullif(source.metadata ->> 'formula_hourly_rate_cents', '')::integer) as hourly_rate_cents
  from public.job_budgets source
  where source.job_id = job.id
    and source.status = any (array['active'::text, 'closed'::text])
  order by
    (source.status = 'active'::text) desc,
    (source.source = any (array['manual'::text, 'project_budget'::text])) desc,
    (source.source = 'manual'::text) desc,
    source.version desc,
    source.updated_at desc,
    source.id
  limit 1
) budget on true
left join lateral (
  select case when budget.budget_minutes > 0 then coalesce(
    budget.hourly_rate_cents,
    (select nullif(org.settings #>> '{labour_budget,planning_hourly_rate_cents}', '')::integer
     from public.organizations org where org.id = job.org_id),
    3000)
  end as budget_hourly_rate_cents
) rate on true
left join lateral (
  select coalesce(sum(
    greatest(0::numeric, extract(epoch from coalesce(entry.ended_at, now()) - entry.started_at) / 60::numeric)
    * coalesce(coalesce(pay.hourly_rate_cents, 3000)::numeric / rate.budget_hourly_rate_cents, 1::numeric)
  ), 0::numeric)::integer as used_minutes
  from public.time_entries entry
  left join lateral (
    select pay_rate.hourly_rate_cents
    from public.employee_pay_rates pay_rate
    where pay_rate.employee_id = entry.employee_id
      and pay_rate.effective_from <= (entry.started_at at time zone 'UTC')::date
    order by pay_rate.effective_from desc
    limit 1
  ) pay on true
  where entry.job_id = job.id
    and entry.status <> 'deleted'::text
) usage on true
where job.is_feed_visible;
