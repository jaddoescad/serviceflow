-- Keep labour budget progress visible when one or more worked time entries do
-- not yet have a matching pay rate. The percentage is calculated from known
-- labour costs only; is_complete remains false so trusted consumers can tell
-- that the displayed percentage may be understated.

create or replace function public.get_project_budget_progress(requested_project_ids text[])
returns table (
  companycam_project_id text,
  percent_used numeric,
  budget_status text,
  is_complete boolean,
  calculated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requested_count integer := coalesce(array_length(requested_project_ids, 1), 0);
begin
  if auth.uid() is null or not exists (
    select 1
    from public.employee_profiles profile
    where profile.user_id = auth.uid()
      and profile.is_active = true
  ) then
    raise exception 'Only active employees can view project budget progress'
      using errcode = '42501';
  end if;

  if requested_count = 0 then
    return;
  end if;

  if requested_count > 100 then
    raise exception 'Budget progress is limited to 100 projects per request'
      using errcode = '22023';
  end if;

  return query
  with requested_projects as (
    select project.companycam_id as companycam_project_id
    from public.companycam_projects project
    join (
      select distinct unnest(requested_project_ids) as companycam_project_id
    ) requested
      on requested.companycam_project_id = project.companycam_id
    where project.is_deleted = false
  ),
  priced_entries as (
    select
      entry.companycam_project_id,
      greatest(
        extract(epoch from (coalesce(entry.ended_at, now()) - entry.started_at)) / 3600.0,
        0
      )::numeric as worked_hours,
      rate.hourly_rate
    from public.time_entries entry
    join requested_projects requested
      on requested.companycam_project_id = entry.companycam_project_id
    left join lateral (
      select employee_rate.hourly_rate
      from public.employee_pay_rates employee_rate
      where employee_rate.user_id = entry.user_id
        and employee_rate.effective_from <= entry.started_at::date
      order by employee_rate.effective_from desc
      limit 1
    ) rate on true
  ),
  time_costs as (
    select
      entry.companycam_project_id,
      coalesce(sum(entry.worked_hours * coalesce(entry.hourly_rate, 0)), 0)::numeric
        as hourly_labour_cost,
      count(*) filter (
        where entry.worked_hours > 0 and entry.hourly_rate is null
      )::integer as missing_rate_count
    from priced_entries entry
    group by entry.companycam_project_id
  ),
  fixed_costs as (
    select
      expense.companycam_project_id,
      coalesce(sum(expense.amount_before_tax), 0)::numeric as fixed_labour_cost
    from public.project_labour_expenses expense
    join requested_projects requested
      on requested.companycam_project_id = expense.companycam_project_id
    group by expense.companycam_project_id
  ),
  metrics as (
    select
      requested.companycam_project_id,
      budget.amount_including_tax,
      budget.labour_allocation_percent,
      coalesce(time_cost.hourly_labour_cost, 0) + coalesce(fixed_cost.fixed_labour_cost, 0)
        as labour_cost_used,
      coalesce(time_cost.missing_rate_count, 0) as missing_rate_count
    from requested_projects requested
    left join public.project_budgets budget
      on budget.companycam_project_id = requested.companycam_project_id
    left join time_costs time_cost
      on time_cost.companycam_project_id = requested.companycam_project_id
    left join fixed_costs fixed_cost
      on fixed_cost.companycam_project_id = requested.companycam_project_id
  ),
  calculated as (
    select
      metric.*,
      case
        when metric.amount_including_tax is null or metric.amount_including_tax <= 0 then null
        else round(
          (metric.amount_including_tax / 1.13) *
          (metric.labour_allocation_percent / 100.0),
          2
        )
      end as labour_budget
    from metrics metric
  ),
  progress as (
    select
      calculated.*,
      case
        when calculated.labour_budget is null or calculated.labour_budget <= 0 then null
        else (calculated.labour_cost_used / calculated.labour_budget) * 100.0
      end as raw_percent_used
    from calculated
  )
  select
    progress.companycam_project_id,
    case
      when progress.raw_percent_used is null then null
      else round(progress.raw_percent_used, 1)
    end as percent_used,
    case
      when progress.labour_budget is null or progress.labour_budget <= 0 then 'not_configured'
      when progress.raw_percent_used > 100 then 'over'
      when progress.raw_percent_used = 100 then 'at'
      else 'under'
    end as budget_status,
    progress.labour_budget is not null
      and progress.labour_budget > 0
      and progress.missing_rate_count = 0 as is_complete,
    now() as calculated_at
  from progress
  order by progress.companycam_project_id;
end;
$$;

comment on function public.get_project_budget_progress(text[]) is
  'Returns percentage-only labour budget progress for up to 100 projects, calculated from known labour costs. is_complete is false when pay-rate coverage is missing. Never returns job amounts, pay rates, or labour costs.';

revoke all on function public.get_project_budget_progress(text[]) from public, anon;
grant execute on function public.get_project_budget_progress(text[]) to authenticated;
