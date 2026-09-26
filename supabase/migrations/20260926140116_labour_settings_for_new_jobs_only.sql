-- Labour budget settings apply to new jobs only.
--
-- Three company settings, in organizations.settings.labour_budget:
--   planning_hourly_rate_cents  standard hourly rate            (default $30)
--   allocation_percent          crew hours %, budget hours      (default 37%)
--   cost_target_percent         labour cost target / alert line (default 40%)
--
-- A job's budget records the settings it was created with. When the job's
-- amount changes later, its hours are recalculated with those recorded
-- numbers, not the company's current ones, so a settings change never moves an
-- existing job. The "recalculate open jobs" option is removed.

update public.organizations
set settings = jsonb_set(settings, '{labour_budget,cost_target_percent}', '40'::jsonb)
where slug = 'ottawa-painters';

drop function public.save_labour_budget_settings(integer, boolean);
drop function public.get_labour_budget_settings();
drop function private.open_formula_budget_jobs(uuid);
drop function private.labour_budget_settings(uuid);

create function private.labour_budget_settings(requested_org_id uuid)
returns table (allocation_percent numeric, planning_hourly_rate_cents integer, cost_target_percent numeric)
language sql stable security definer set search_path = ''
as $$
  select
    coalesce(nullif(o.settings #>> '{labour_budget,allocation_percent}', '')::numeric, 37),
    coalesce(nullif(o.settings #>> '{labour_budget,planning_hourly_rate_cents}', '')::integer, 3000),
    coalesce(nullif(o.settings #>> '{labour_budget,cost_target_percent}', '')::numeric, 40)
  from (select 1) anchor
  left join public.organizations o on o.id = requested_org_id
$$;

revoke all on function private.labour_budget_settings(uuid) from public, anon, authenticated;

-- Existing formula budgets keep their recorded rate and percent; new ones
-- record the company's current settings, including the cost target.
do $$
declare
  definition text := pg_get_functiondef('private.ensure_default_job_budget(uuid,bigint)'::regprocedure);
  patches text[][] := array[
    array[$p$planning_hourly_rate_cents\s+integer\s*:=\s*3000;$p$,
          'planning_hourly_rate_cents integer := 3000;
  cost_target_percent numeric := 40;'],
    array[$p$select\s+s\.allocation_percent,\s*s\.planning_hourly_rate_cents\s+into\s+allocation_percent,\s*planning_hourly_rate_cents\s+from\s+private\.labour_budget_settings\(source_job\.org_id\)\s+s;$p$,
          'select s.allocation_percent, s.planning_hourly_rate_cents, s.cost_target_percent
  into allocation_percent, planning_hourly_rate_cents, cost_target_percent
  from private.labour_budget_settings(source_job.org_id) s;

  -- A budget keeps the rate and percent it was created with.
  if current_budget.id is not null then
    allocation_percent := coalesce(
      nullif(current_budget.metadata ->> ''formula_allocation_percent'', '''')::numeric,
      allocation_percent);
    planning_hourly_rate_cents := coalesce(
      nullif(current_budget.metadata ->> ''formula_hourly_rate_cents'', '''')::integer,
      current_budget.hourly_rate_cents,
      planning_hourly_rate_cents);
  end if;'],
    array[$p$40,\s*'project_budget',\s*jsonb_build_object\(\s*'budget_minutes_source',\s*'formula',$p$,
          'cost_target_percent,
    ''project_budget'',
    jsonb_build_object(
      ''cost_target_percent'', cost_target_percent,
      ''budget_minutes_source'', ''formula'',']
  ];
  i integer;
begin
  for i in 1 .. array_length(patches, 1) loop
    if (select count(*) from regexp_matches(definition, patches[i][1], 'g')) <> 1 then
      raise exception 'ensure_default_job_budget patch % no longer matches', i;
    end if;
    definition := regexp_replace(definition, patches[i][1], patches[i][2]);
  end loop;
  execute definition;
end
$$;

-- A job's first hand-entered budget records the company's cost target
-- instead of a fixed 40.
do $$
declare
  definition text := pg_get_functiondef('private.save_job_budget__unscoped(uuid,integer,integer,bigint,text)'::regprocedure);
  pattern text := $p$coalesce\(previous_budget\.labour_allocation_percent,\s*40\)$p$;
begin
  if (select count(*) from regexp_matches(definition, pattern, 'g')) <> 1 then
    raise exception 'save_job_budget no longer matches the expected cost target default';
  end if;
  execute regexp_replace(definition, pattern,
    'coalesce(previous_budget.labour_allocation_percent,
      (select s.cost_target_percent from public.jobs j
         cross join lateral private.labour_budget_settings(j.org_id) s
        where j.id = requested_job_id))');
end
$$;

create function public.get_labour_budget_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.acting_org_id();
  current_settings record;
begin
  if not private.is_org_member(company) then
    raise exception 'You do not have access to this company.' using errcode = '42501';
  end if;
  select * into current_settings from private.labour_budget_settings(company);
  return jsonb_build_object(
    'hourly_rate_cents', current_settings.planning_hourly_rate_cents,
    'crew_hours_percent', current_settings.allocation_percent,
    'cost_target_percent', current_settings.cost_target_percent,
    'can_edit', coalesce(private.org_role(company) in ('owner', 'admin'), false));
end
$$;

create function public.save_labour_budget_settings(
  requested_hourly_rate_cents integer,
  requested_crew_hours_percent numeric,
  requested_cost_target_percent numeric)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.acting_org_id();
begin
  perform private.set_acting_org(company);
  if coalesce(private.org_role(company) not in ('owner', 'admin'), true) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if requested_hourly_rate_cents is null
    or requested_hourly_rate_cents < 100 or requested_hourly_rate_cents > 50000 then
    raise exception 'Enter an hourly rate between $1 and $500.' using errcode = '22023';
  end if;
  if requested_crew_hours_percent is null
    or requested_crew_hours_percent < 1 or requested_crew_hours_percent > 100 then
    raise exception 'Enter a crew hours percentage between 1 and 100.' using errcode = '22023';
  end if;
  if requested_cost_target_percent is null
    or requested_cost_target_percent < 1 or requested_cost_target_percent > 100 then
    raise exception 'Enter a labour cost target between 1 and 100.' using errcode = '22023';
  end if;

  update public.organizations
  set settings = jsonb_set(settings, '{labour_budget}',
        coalesce(settings -> 'labour_budget', '{}'::jsonb) || jsonb_build_object(
          'planning_hourly_rate_cents', requested_hourly_rate_cents,
          'allocation_percent', round(requested_crew_hours_percent, 1),
          'cost_target_percent', round(requested_cost_target_percent, 1))),
      updated_at = now()
  where id = company;

  return public.get_labour_budget_settings();
end
$$;

revoke all on function public.get_labour_budget_settings() from public, anon;
revoke all on function public.save_labour_budget_settings(integer, numeric, numeric) from public, anon;
grant execute on function public.get_labour_budget_settings() to authenticated;
grant execute on function public.save_labour_budget_settings(integer, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
