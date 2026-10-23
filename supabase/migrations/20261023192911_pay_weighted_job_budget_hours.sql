-- Budget hours count each painter's pay, and the standard rate moves to $35.
--
-- A job's labour budget is dollars (job amount x crew hours %) shown as hours
-- at the standard rate. Clocked time now uses that budget at the painter's
-- pay divided by the job's rate: at $35, a $30/h painter's hour uses 51m 26s
-- and a $37/h painter's hour uses 1h 3m. The budget therefore runs out when
-- wages reach the labour dollars, whoever works the job. Painters without a
-- pay rate, and jobs without an hour budget, count clocked time one for one.
--
-- Ottawa Painters' standard rate becomes $35. Its open formula budgets move
-- from $30 to $35 (fewer hours, same dollars, same percent used), and its open
-- hand-set budgets record $35 so a later settings change does not move them.
-- Jobs under the June 1 accounting lock are not touched.

update public.organizations
set settings = jsonb_set(settings, '{labour_budget,planning_hourly_rate_cents}', '3500'::jsonb)
where slug = 'ottawa-painters';

with open_budget as (
  select budget.id
  from public.job_budgets budget
  join public.jobs job on job.id = budget.job_id
  join public.organizations org on org.id = job.org_id and org.slug = 'ottawa-painters'
  where job.status in ('active', 'scheduled')
    and not public.is_historical_job_accounting_locked(job.id)
    and budget.status = 'active'
    and budget.source in ('manual', 'project_budget')
    and budget.metadata ->> 'budget_minutes_source' = 'formula'
    and budget.hourly_rate_cents = 3000
)
update public.job_budgets budget
set
  budget_minutes = round(
    coalesce(nullif(budget.metadata ->> 'formula_amount_cents', '')::numeric, budget.amount_including_tax_cents)
    * coalesce(nullif(budget.metadata ->> 'formula_allocation_percent', '')::numeric, 37) / 100
    * 60 / 3500)::integer,
  calculated_minutes = round(
    coalesce(nullif(budget.metadata ->> 'formula_amount_cents', '')::numeric, budget.amount_including_tax_cents)
    * coalesce(nullif(budget.metadata ->> 'formula_allocation_percent', '')::numeric, 37) / 100
    * 60 / 3500)::integer,
  hourly_rate_cents = 3500,
  metadata = budget.metadata || jsonb_build_object(
    'formula_hourly_rate_cents', 3500,
    'formula_previous_hourly_rate_cents', 3000,
    'formula_updated_at', now()),
  updated_at = now()
from open_budget
where budget.id = open_budget.id
  and coalesce(nullif(budget.metadata ->> 'formula_amount_cents', '')::numeric, budget.amount_including_tax_cents) > 0;

with open_budget as (
  select budget.id
  from public.job_budgets budget
  join public.jobs job on job.id = budget.job_id
  join public.organizations org on org.id = job.org_id and org.slug = 'ottawa-painters'
  where job.status in ('active', 'scheduled')
    and not public.is_historical_job_accounting_locked(job.id)
    and budget.status = 'active'
    and budget.source in ('manual', 'project_budget')
    and budget.metadata ->> 'budget_minutes_source' is distinct from 'formula'
    and budget.budget_minutes > 0
    and budget.hourly_rate_cents is null
)
update public.job_budgets budget
set
  hourly_rate_cents = 3500,
  metadata = budget.metadata || jsonb_build_object('budget_rate_recorded_at', now()),
  updated_at = now()
from open_budget
where budget.id = open_budget.id;

-- Same columns as before, plus the rate the budget hours are counted at.
-- Pay rates are read as the caller (security_invoker); org members can read
-- them today. If they become manager-only, move this sum into a definer
-- function, or crew will see one-for-one hours.
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
    * coalesce(pay.hourly_rate_cents::numeric / rate.budget_hourly_rate_cents, 1::numeric)
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
