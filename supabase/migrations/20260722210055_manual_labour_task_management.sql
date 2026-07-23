-- Manual painter-task management: add, edit, and remove tasks outside the
-- calculator publish flow. Manual tasks use source_kind 'custom' and attach to
-- the active labour budget (created on demand when none exists).

create or replace function public.add_project_labour_task(
  requested_project_id text,
  requested_title text,
  requested_notes text default null,
  requested_budgeted_hours numeric default null
)
returns setof public.project_labour_tasks
language plpgsql
security definer
set search_path to ''
as $$
declare
  clean_title text := nullif(btrim(requested_title), '');
  clean_notes text := nullif(btrim(coalesce(requested_notes, '')), '');
  clean_hours numeric := round(coalesce(requested_budgeted_hours, 0), 2);
  active_budget public.project_labour_budgets%rowtype;
  new_progress_id uuid;
  new_item_id text := gen_random_uuid()::text;
  next_sort integer;
  new_task_id uuid;
begin
  if auth.uid() is null
    or public.current_employee_role() not in ('admin', 'manager') then
    raise exception 'Only active admins and managers can manage painter tasks'
      using errcode = '42501';
  end if;

  if nullif(btrim(requested_project_id), '') is null then
    raise exception 'A project ID is required' using errcode = '22023';
  end if;
  if clean_title is null then
    raise exception 'A task title is required' using errcode = '22023';
  end if;
  if clean_hours < 0 then
    raise exception 'Task hours must be zero or greater' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requested_project_id, 0));

  perform 1
  from public.companycam_projects project
  where project.companycam_id = requested_project_id
  limit 1;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  select budget.*
  into active_budget
  from public.project_labour_budgets budget
  where budget.companycam_project_id = requested_project_id
    and budget.is_active = true
  order by budget.revision desc
  limit 1
  for update;

  if not found then
    insert into public.project_labour_budgets (
      companycam_project_id,
      source_quote_id,
      source_quote_name,
      source_quote_updated_at,
      instructions,
      calculated_hours,
      budgeted_hours,
      revision,
      is_active,
      published_by,
      published_at
    )
    select
      requested_project_id,
      'manual-tasks',
      'Manual tasks',
      timezone('utc', now()),
      null,
      0,
      0,
      coalesce(max(budget.revision), 0) + 1,
      true,
      auth.uid(),
      timezone('utc', now())
    from public.project_labour_budgets budget
    where budget.companycam_project_id = requested_project_id
    returning * into active_budget;
  end if;

  insert into public.project_labour_task_progress (
    companycam_project_id,
    source_kind,
    source_item_id
  ) values (
    requested_project_id,
    'custom',
    new_item_id
  )
  returning id into new_progress_id;

  select coalesce(max(task.sort_order), 0) + 1
  into next_sort
  from public.project_labour_tasks task
  where task.companycam_project_id = requested_project_id
    and task.is_active = true;

  insert into public.project_labour_tasks (
    labour_budget_id,
    progress_id,
    companycam_project_id,
    source_quote_id,
    source_kind,
    source_item_id,
    title,
    notes,
    calculated_hours,
    manual_budgeted_hours,
    budgeted_hours,
    sort_order,
    status,
    is_active,
    budget_revision,
    metadata
  ) values (
    active_budget.id,
    new_progress_id,
    requested_project_id,
    active_budget.source_quote_id,
    'custom',
    new_item_id,
    clean_title,
    clean_notes,
    clean_hours,
    null,
    clean_hours,
    next_sort,
    'pending',
    true,
    active_budget.revision,
    '{}'::jsonb
  )
  returning id into new_task_id;

  return query
  select task.* from public.project_labour_tasks task where task.id = new_task_id;
end;
$$;

create or replace function public.update_project_labour_task(
  requested_project_id text,
  requested_task_id uuid,
  requested_title text,
  requested_notes text default null,
  requested_budgeted_hours numeric default null
)
returns setof public.project_labour_tasks
language plpgsql
security definer
set search_path to ''
as $$
declare
  clean_title text := nullif(btrim(requested_title), '');
  clean_notes text := nullif(btrim(coalesce(requested_notes, '')), '');
  active_task public.project_labour_tasks%rowtype;
begin
  if auth.uid() is null
    or public.current_employee_role() not in ('admin', 'manager') then
    raise exception 'Only active admins and managers can manage painter tasks'
      using errcode = '42501';
  end if;

  if clean_title is null then
    raise exception 'A task title is required' using errcode = '22023';
  end if;
  if requested_budgeted_hours is not null and requested_budgeted_hours < 0 then
    raise exception 'Task hours must be zero or greater' using errcode = '22023';
  end if;

  select task.*
  into active_task
  from public.project_labour_tasks task
  where task.id = requested_task_id
    and task.companycam_project_id = requested_project_id
    and task.is_active = true
  for update;

  if not found then
    raise exception 'Active task not found' using errcode = 'P0002';
  end if;

  update public.project_labour_tasks task
  set title = clean_title,
      notes = clean_notes,
      -- Custom tasks store their hours as calculated hours; calculator tasks
      -- keep calculated hours from the quote and use the manual override.
      calculated_hours = case
        when task.source_kind = 'custom' and requested_budgeted_hours is not null
          then round(requested_budgeted_hours, 2)
        else task.calculated_hours
      end,
      manual_budgeted_hours = case
        when task.source_kind = 'custom' then null
        when requested_budgeted_hours is null then null
        else round(requested_budgeted_hours, 2)
      end
  where task.id = requested_task_id;

  return query
  select task.* from public.project_labour_tasks task where task.id = requested_task_id;
end;
$$;

create or replace function public.remove_project_labour_task(
  requested_project_id text,
  requested_task_id uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  active_task public.project_labour_tasks%rowtype;
begin
  if auth.uid() is null
    or public.current_employee_role() not in ('admin', 'manager') then
    raise exception 'Only active admins and managers can manage painter tasks'
      using errcode = '42501';
  end if;

  select task.*
  into active_task
  from public.project_labour_tasks task
  where task.id = requested_task_id
    and task.companycam_project_id = requested_project_id
    and task.is_active = true
  for update;

  if not found then
    raise exception 'Active task not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.project_labour_task_time_entries timer
    where timer.progress_id = active_task.progress_id
      and timer.ended_at is null
  ) then
    raise exception 'A painter is timing this task right now. Stop the timer before removing it.'
      using errcode = '55000';
  end if;

  -- Soft delete so recorded time history is preserved.
  update public.project_labour_tasks task
  set is_active = false
  where task.id = requested_task_id;
end;
$$;

revoke all on function public.add_project_labour_task(text, text, text, numeric) from public, anon;
revoke all on function public.update_project_labour_task(text, uuid, text, text, numeric) from public, anon;
revoke all on function public.remove_project_labour_task(text, uuid) from public, anon;
grant execute on function public.add_project_labour_task(text, text, text, numeric) to authenticated;
grant execute on function public.update_project_labour_task(text, uuid, text, text, numeric) to authenticated;
grant execute on function public.remove_project_labour_task(text, uuid) to authenticated;;
