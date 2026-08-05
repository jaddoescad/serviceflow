begin;

-- The V2 cutover merged CompanyCam and DripJobs aliases into canonical jobs.
-- For some jobs that produced two migrated project_budget rows: the newer row
-- carried the authoritative DripJobs amount but no hours, while the older row
-- carried the existing painter-hour budget. Preserve both pieces of data on
-- the current row instead of allowing the blank value to mask the hours.
with ranked_operational_budgets as (
  select
    budget.*,
    row_number() over (
      partition by budget.job_id
      order by
        (budget.source = 'manual') desc,
        budget.updated_at desc,
        budget.version desc,
        budget.id
    ) as current_rank
  from public.job_budgets budget
  where budget.source in ('manual', 'project_budget')
    and budget.status in ('active', 'closed')
), repairs as (
  select
    current.id as current_budget_id,
    fallback.id as fallback_budget_id,
    fallback.budget_minutes
  from ranked_operational_budgets current
  join lateral (
    select candidate.*
    from ranked_operational_budgets candidate
    where candidate.job_id = current.job_id
      and candidate.id <> current.id
      and candidate.budget_minutes > 0
    order by
      (candidate.source = 'manual') desc,
      candidate.updated_at desc,
      candidate.version desc,
      candidate.id
    limit 1
  ) fallback on true
  where current.current_rank = 1
    and current.budget_minutes is null
)
update public.job_budgets budget
set
  budget_minutes = repair.budget_minutes,
  metadata = coalesce(budget.metadata, '{}'::jsonb) || jsonb_build_object(
    'budget_minutes_repaired_from_budget_id', repair.fallback_budget_id,
    'budget_minutes_repaired_at', now()
  ),
  updated_at = now()
from repairs repair
where budget.id = repair.current_budget_id;

-- Keep historical rows, but allow only one active high-level budget per job.
-- Manual rows are explicit overrides and therefore win over imported rows.
with ranked_active_budgets as (
  select
    budget.id,
    row_number() over (
      partition by budget.job_id
      order by
        (budget.source = 'manual') desc,
        budget.updated_at desc,
        budget.version desc,
        budget.id
    ) as active_rank
  from public.job_budgets budget
  where budget.source in ('manual', 'project_budget')
    and budget.status = 'active'
)
update public.job_budgets budget
set
  status = 'superseded',
  metadata = coalesce(budget.metadata, '{}'::jsonb) || jsonb_build_object(
    'superseded_during_budget_repair_at', now()
  ),
  updated_at = now()
from ranked_active_budgets ranked
where budget.id = ranked.id
  and ranked.active_rank > 1;

create unique index if not exists job_budgets_one_active_operational_idx
  on public.job_budgets(job_id)
  where source in ('manual', 'project_budget')
    and status = 'active';

-- A first manual edit must inherit every existing operational field and retire
-- the imported active row. This prevents a later amount-only edit from hiding
-- hours, allocation settings, or actual-cost overrides.
create or replace function public.save_job_budget(
  requested_job_id uuid,
  requested_budget_minutes integer,
  requested_hourly_rate_cents integer default null,
  requested_amount_including_tax_cents bigint default null,
  requested_notes text default null
)
returns public.job_budgets
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_budget public.job_budgets%rowtype;
  previous_budget public.job_budgets%rowtype;
  result public.job_budgets%rowtype;
  next_version integer;
begin
  if not private.is_manager() then raise exception 'Manager access required'; end if;

  select * into current_budget
  from public.job_budgets budget
  where budget.job_id = requested_job_id
    and budget.source = 'manual'
  order by budget.version desc
  limit 1
  for update;

  if found then
    update public.job_budgets budget
    set
      budget_minutes = coalesce(requested_budget_minutes, budget.budget_minutes),
      hourly_rate_cents = coalesce(requested_hourly_rate_cents, budget.hourly_rate_cents),
      amount_including_tax_cents = coalesce(
        requested_amount_including_tax_cents,
        budget.amount_including_tax_cents
      ),
      notes = coalesce(requested_notes, budget.notes),
      updated_at = now()
    where budget.id = current_budget.id
    returning * into result;
  else
    select * into previous_budget
    from public.job_budgets budget
    where budget.job_id = requested_job_id
      and budget.source = 'project_budget'
      and budget.status in ('active', 'closed')
    order by
      (budget.budget_minutes is not null) desc,
      budget.updated_at desc,
      budget.version desc
    limit 1
    for update;

    if found and previous_budget.status = 'active' then
      update public.job_budgets budget
      set
        status = 'superseded',
        updated_at = now()
      where budget.id = previous_budget.id;
    end if;

    select coalesce(max(budget.version), 0) + 1 into next_version
    from public.job_budgets budget
    where budget.job_id = requested_job_id
      and budget.source = 'manual';

    insert into public.job_budgets (
      id, job_id, quote_id, version, status, budget_minutes,
      calculated_minutes, hourly_rate_cents, amount_including_tax_cents,
      labour_allocation_percent, actual_labour_cost_cents,
      instructions, notes, closed_at, closed_by, source, metadata,
      created_at, updated_at
    )
    select
      extensions.gen_random_uuid(),
      job.id,
      job.accepted_quote_id,
      next_version,
      coalesce(previous_budget.status, 'active'),
      coalesce(requested_budget_minutes, previous_budget.budget_minutes),
      previous_budget.calculated_minutes,
      coalesce(requested_hourly_rate_cents, previous_budget.hourly_rate_cents),
      coalesce(
        requested_amount_including_tax_cents,
        previous_budget.amount_including_tax_cents
      ),
      coalesce(previous_budget.labour_allocation_percent, 40),
      previous_budget.actual_labour_cost_cents,
      previous_budget.instructions,
      coalesce(requested_notes, previous_budget.notes),
      previous_budget.closed_at,
      previous_budget.closed_by,
      'manual',
      jsonb_build_object('copied_from_budget_id', previous_budget.id),
      now(),
      now()
    from public.jobs job
    where job.id = requested_job_id
    returning * into result;

    if not found then raise exception 'Job not found'; end if;
  end if;

  if requested_amount_including_tax_cents is not null then
    update public.jobs
    set contract_amount_cents = requested_amount_including_tax_cents,
        updated_at = now()
    where id = requested_job_id;
  end if;

  return result;
end
$$;

do $$
begin
  if exists (
    select 1
    from public.job_budgets budget
    where budget.source in ('manual', 'project_budget')
      and budget.status = 'active'
    group by budget.job_id
    having count(*) > 1
  ) then
    raise exception 'Budget repair left multiple active operational budgets for a job';
  end if;

  if exists (
    with ranked_operational_budgets as (
      select
        budget.*,
        row_number() over (
          partition by budget.job_id
          order by
            (budget.source = 'manual') desc,
            budget.updated_at desc,
            budget.version desc,
            budget.id
        ) as current_rank
      from public.job_budgets budget
      where budget.source in ('manual', 'project_budget')
        and budget.status in ('active', 'closed')
    )
    select 1
    from ranked_operational_budgets current
    where current.current_rank = 1
      and current.budget_minutes is null
      and exists (
        select 1
        from ranked_operational_budgets fallback
        where fallback.job_id = current.job_id
          and fallback.id <> current.id
          and fallback.budget_minutes > 0
      )
  ) then
    raise exception 'Budget repair left a current blank budget masking older hours';
  end if;
end
$$;

commit;
