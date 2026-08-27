begin;

-- Budget painter-hours at the same $30/hour rate used by the current field
-- team. Keep the 37% share unchanged; only the planning hourly rate changes.
update public.app_config
set
  settings = jsonb_set(
    coalesce(settings, '{}'::jsonb),
    '{labour_budget,planning_hourly_rate_cents}',
    to_jsonb(3000),
    true
  ),
  updated_at = now()
where id = 'default';

-- Create or refresh a formula-derived hour budget without overwriting hours
-- explicitly published by the calculator or set by an administrator.
create or replace function private.ensure_default_job_budget(
  requested_job_id uuid,
  requested_amount_cents bigint default null
)
returns public.job_budgets
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_job public.jobs%rowtype;
  current_budget public.job_budgets%rowtype;
  published_budget public.job_budgets%rowtype;
  result public.job_budgets%rowtype;
  effective_amount_cents bigint;
  allocation_percent numeric := 37;
  planning_hourly_rate_cents integer := 3000;
  derived_minutes integer;
  next_version integer;
begin
  select * into source_job
  from public.jobs job
  where job.id = requested_job_id
  for update;

  if not found then
    raise exception 'Job not found';
  end if;

  select * into current_budget
  from public.job_budgets budget
  where budget.job_id = requested_job_id
    and budget.source in ('manual', 'project_budget')
    and budget.status in ('active', 'closed')
  order by
    (budget.status = 'active') desc,
    (budget.source = 'manual') desc,
    budget.version desc,
    budget.updated_at desc,
    budget.id
  limit 1
  for update;

  if found then
    if current_budget.budget_minutes is not null
      and current_budget.metadata ->> 'budget_minutes_source' is distinct from 'formula' then
      return current_budget;
    end if;

    effective_amount_cents := coalesce(
      requested_amount_cents,
      current_budget.amount_including_tax_cents,
      source_job.contract_amount_cents
    );
  else
    -- A published calculator budget is already explicit. Do not create a
    -- competing formula budget when it is the only configured hour budget.
    select * into published_budget
    from public.job_budgets budget
    where budget.job_id = requested_job_id
      and budget.source = 'published_labour_budget'
      and budget.status in ('active', 'closed')
      and budget.budget_minutes is not null
    order by
      (budget.status = 'active') desc,
      budget.version desc,
      budget.updated_at desc,
      budget.id
    limit 1
    for update;

    if found then
      return published_budget;
    end if;

    effective_amount_cents := coalesce(
      requested_amount_cents,
      source_job.contract_amount_cents
    );
  end if;

  if effective_amount_cents is null or effective_amount_cents <= 0 then
    return null;
  end if;

  select
    coalesce(
      nullif(config.settings #>> '{labour_budget,allocation_percent}', '')::numeric,
      37
    ),
    coalesce(
      nullif(config.settings #>> '{labour_budget,planning_hourly_rate_cents}', '')::integer,
      3000
    )
  into allocation_percent, planning_hourly_rate_cents
  from public.app_config config
  where config.id = 'default';

  allocation_percent := coalesce(allocation_percent, 37);
  planning_hourly_rate_cents := coalesce(planning_hourly_rate_cents, 3000);

  if planning_hourly_rate_cents <= 0 then
    raise exception 'The labour planning hourly rate must be greater than zero';
  end if;

  derived_minutes := round(
    effective_amount_cents::numeric
    * allocation_percent / 100
    * 60 / planning_hourly_rate_cents
  )::integer;

  if current_budget.id is not null then
    update public.job_budgets budget
    set
      budget_minutes = derived_minutes,
      calculated_minutes = derived_minutes,
      hourly_rate_cents = planning_hourly_rate_cents,
      amount_including_tax_cents = effective_amount_cents,
      metadata = coalesce(budget.metadata, '{}'::jsonb) || jsonb_build_object(
        'budget_minutes_source', 'formula',
        'formula_allocation_percent', allocation_percent,
        'formula_hourly_rate_cents', planning_hourly_rate_cents,
        'formula_amount_cents', effective_amount_cents,
        'formula_updated_at', now()
      ),
      updated_at = now()
    where budget.id = current_budget.id
    returning * into result;

    return result;
  end if;

  select coalesce(max(budget.version), 0) + 1
  into next_version
  from public.job_budgets budget
  where budget.job_id = requested_job_id;

  insert into public.job_budgets (
    id, job_id, quote_id, version, status, budget_minutes,
    calculated_minutes, hourly_rate_cents, amount_including_tax_cents,
    labour_allocation_percent, source, metadata, created_at, updated_at
  ) values (
    extensions.gen_random_uuid(),
    source_job.id,
    source_job.accepted_quote_id,
    next_version,
    case
      when source_job.status in ('completed', 'cancelled', 'archived') then 'closed'
      else 'active'
    end,
    derived_minutes,
    derived_minutes,
    planning_hourly_rate_cents,
    effective_amount_cents,
    40,
    'project_budget',
    jsonb_build_object(
      'budget_minutes_source', 'formula',
      'formula_allocation_percent', allocation_percent,
      'formula_hourly_rate_cents', planning_hourly_rate_cents,
      'formula_amount_cents', effective_amount_cents,
      'formula_updated_at', now()
    ),
    now(),
    now()
  )
  returning * into result;

  return result;
end
$$;

revoke all on function private.ensure_default_job_budget(uuid, bigint)
  from public, anon, authenticated;

-- Refresh only current formula budgets for open, non-historical jobs. Explicit
-- budgets and jobs before the accounting cutoff remain untouched.
do $$
declare
  target record;
begin
  for target in
    select job.id
    from public.jobs job
    where job.status in ('scheduled', 'active')
      and (job.started_on is null or job.started_on >= date '2026-06-01')
      and exists (
        select 1
        from public.job_budgets budget
        where budget.job_id = job.id
          and budget.source in ('manual', 'project_budget')
          and budget.status in ('active', 'closed')
          and budget.metadata ->> 'budget_minutes_source' = 'formula'
      )
    order by job.id
  loop
    perform private.ensure_default_job_budget(target.id, null);
  end loop;
end
$$;

do $$
begin
  if (
    select config.settings #>> '{labour_budget,planning_hourly_rate_cents}'
    from public.app_config config
    where config.id = 'default'
  ) <> '3000' then
    raise exception 'The labour planning hourly rate was not set to $30';
  end if;

  if exists (
    select 1
    from public.jobs job
    join lateral (
      select budget.*
      from public.job_budgets budget
      where budget.job_id = job.id
        and budget.source in ('manual', 'project_budget')
        and budget.status in ('active', 'closed')
      order by
        (budget.status = 'active') desc,
        (budget.source = 'manual') desc,
        budget.version desc,
        budget.updated_at desc,
        budget.id
      limit 1
    ) budget on true
    where job.status in ('scheduled', 'active')
      and (job.started_on is null or job.started_on >= date '2026-06-01')
      and budget.metadata ->> 'budget_minutes_source' = 'formula'
      and (
        budget.hourly_rate_cents <> 3000
        or budget.metadata ->> 'formula_hourly_rate_cents' <> '3000'
      )
  ) then
    raise exception 'An open formula budget still uses the old planning rate';
  end if;
end
$$;

commit;
