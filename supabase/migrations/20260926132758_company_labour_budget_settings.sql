-- Labour budget settings per company, editable from admin Settings.
--
-- Budget hours = job amount x labour % / standard hourly rate. The rate and
-- percent were app-wide (app_config.settings.labour_budget); each company now
-- keeps its own in organizations.settings. Ottawa Painters starts with the
-- app-wide values; a company that hasn't set them gets 37% and $30/h. The
-- app-wide values are no longer read.
--
-- Changing the rate applies to new formula budgets. The admin can also ask to
-- recalculate open jobs whose budget comes from the formula; hand-set and
-- calculator-published budgets, closed jobs and jobs under the historical
-- accounting lock are never touched.

alter table public.organizations
  add column settings jsonb not null default '{}'::jsonb;

update public.organizations o
set settings = jsonb_build_object('labour_budget', jsonb_build_object(
  'allocation_percent', coalesce(
    nullif(c.settings #>> '{labour_budget,allocation_percent}', '')::numeric, 37),
  'planning_hourly_rate_cents', coalesce(
    nullif(c.settings #>> '{labour_budget,planning_hourly_rate_cents}', '')::integer, 3000)))
from public.app_config c
where c.id = 'default' and o.slug = 'ottawa-painters';

create function private.labour_budget_settings(requested_org_id uuid)
returns table (allocation_percent numeric, planning_hourly_rate_cents integer)
language sql stable security definer set search_path = ''
as $$
  select
    coalesce(nullif(o.settings #>> '{labour_budget,allocation_percent}', '')::numeric, 37),
    coalesce(nullif(o.settings #>> '{labour_budget,planning_hourly_rate_cents}', '')::integer, 3000)
  from (select 1) anchor
  left join public.organizations o on o.id = requested_org_id
$$;

revoke all on function private.labour_budget_settings(uuid) from public, anon, authenticated;

-- The formula reads the job's company instead of the app-wide config.
do $$
declare
  definition text := pg_get_functiondef('private.ensure_default_job_budget(uuid,bigint)'::regprocedure);
  pattern text := $p$select\s+coalesce\(\s*nullif\(config\.settings.*where\s+config\.id\s*=\s*'default';$p$;
begin
  if (select count(*) from regexp_matches(definition, pattern, 'g')) <> 1 then
    raise exception 'ensure_default_job_budget no longer matches the expected settings lookup';
  end if;
  execute regexp_replace(definition, pattern,
    'select s.allocation_percent, s.planning_hourly_rate_cents
  into allocation_percent, planning_hourly_rate_cents
  from private.labour_budget_settings(source_job.org_id) s;');
end
$$;

-- Open jobs whose active budget comes from the formula, split by whether the
-- historical accounting lock protects them.
create function private.open_formula_budget_jobs(requested_org_id uuid)
returns table (job_id uuid, locked boolean)
language sql stable security definer set search_path = ''
as $$
  select distinct b.job_id, public.is_historical_job_accounting_locked(b.job_id)
  from public.job_budgets b
  join public.jobs j on j.id = b.job_id
  where b.org_id = requested_org_id
    and b.status = 'active'
    and b.source in ('manual', 'project_budget')
    and b.metadata ->> 'budget_minutes_source' = 'formula'
    and j.status not in ('completed', 'cancelled', 'archived')
    and not exists (
      select 1 from public.job_budgets hand_set
      where hand_set.job_id = b.job_id
        and hand_set.status = 'active'
        and hand_set.source = 'manual'
        and hand_set.metadata ->> 'budget_minutes_source' is distinct from 'formula'
    )
$$;

revoke all on function private.open_formula_budget_jobs(uuid) from public, anon, authenticated;

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
    'allocation_percent', current_settings.allocation_percent,
    'can_edit', coalesce(private.org_role(company) in ('owner', 'admin'), false),
    'open_formula_jobs', (select count(*) from private.open_formula_budget_jobs(company) where not locked),
    'locked_formula_jobs', (select count(*) from private.open_formula_budget_jobs(company) where locked));
end
$$;

create function public.save_labour_budget_settings(
  requested_hourly_rate_cents integer, recalculate_open_jobs boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.acting_org_id();
  target record;
  recalculated integer := 0;
begin
  perform private.set_acting_org(company);
  if coalesce(private.org_role(company) not in ('owner', 'admin'), true) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if requested_hourly_rate_cents is null
    or requested_hourly_rate_cents < 100 or requested_hourly_rate_cents > 50000 then
    raise exception 'Enter an hourly rate between $1 and $500.' using errcode = '22023';
  end if;

  update public.organizations
  set settings = jsonb_set(settings, '{labour_budget}',
        coalesce(settings -> 'labour_budget', '{}'::jsonb)
        || jsonb_build_object('planning_hourly_rate_cents', requested_hourly_rate_cents)),
      updated_at = now()
  where id = company;

  if recalculate_open_jobs then
    for target in
      select job_id from private.open_formula_budget_jobs(company) where not locked
    loop
      perform private.ensure_default_job_budget(target.job_id, null);
      recalculated := recalculated + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'hourly_rate_cents', requested_hourly_rate_cents,
    'recalculated_jobs', recalculated);
end
$$;

revoke all on function public.get_labour_budget_settings() from public, anon;
revoke all on function public.save_labour_budget_settings(integer, boolean) from public, anon;
grant execute on function public.get_labour_budget_settings() to authenticated;
grant execute on function public.save_labour_budget_settings(integer, boolean) to authenticated;

notify pgrst, 'reload schema';
