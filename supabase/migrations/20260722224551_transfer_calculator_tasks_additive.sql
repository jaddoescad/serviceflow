-- Decouple the calculator from the painter task list. Transferring copies the
-- calculator's items into the task list: existing tasks with the same source
-- identity are updated in place, new items are appended, and nothing is ever
-- deactivated or removed. Manual tasks and tasks from other quotes are
-- untouched. Painter progress, timers, and manual hour overrides survive.

create or replace function public.transfer_project_calculator_tasks(
  requested_project_id text,
  calculator_doc jsonb,
  requested_quote_id text,
  task_payloads jsonb
)
returns table(
  labour_budget_id uuid,
  companycam_project_id text,
  source_quote_id text,
  source_quote_name text,
  source_quote_updated_at timestamp with time zone,
  budgeted_hours numeric,
  task_count integer,
  revision integer,
  published_at timestamp with time zone
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  quote_payload jsonb;
  task_payload jsonb;
  task_kind text;
  task_item_id text;
  task_title text;
  task_hours numeric;
  task_metadata jsonb;
  task_progress_id uuid;
  task_status text;
  task_completed_by uuid;
  task_completed_at timestamptz;
  existing_task_id uuid;
  next_sort integer;
  active_budget public.project_labour_budgets%rowtype;
begin
  if auth.uid() is null
    or public.current_employee_role() not in ('admin', 'manager') then
    raise exception 'Only active admins and managers can transfer calculator tasks'
      using errcode = '42501';
  end if;

  if nullif(btrim(requested_project_id), '') is null then
    raise exception 'A project ID is required' using errcode = '22023';
  end if;

  if jsonb_typeof(calculator_doc) <> 'object'
    or jsonb_typeof(calculator_doc -> 'quotes') <> 'array' then
    raise exception 'The calculator document is invalid' using errcode = '22023';
  end if;

  select quote.value
  into quote_payload
  from jsonb_array_elements(calculator_doc -> 'quotes') quote(value)
  where quote.value ->> 'id' = requested_quote_id
  limit 1;

  if quote_payload is null then
    raise exception 'The selected quote is not in this calculator document'
      using errcode = '22023';
  end if;

  if jsonb_typeof(task_payloads) <> 'array' then
    raise exception 'Calculator tasks must be an array' using errcode = '22023';
  end if;

  if jsonb_array_length(task_payloads) > 500 then
    raise exception 'A transfer is limited to 500 tasks' using errcode = '22023';
  end if;

  for task_payload in
    select value from jsonb_array_elements(task_payloads)
  loop
    task_kind := task_payload ->> 'sourceKind';
    task_item_id := nullif(btrim(task_payload ->> 'sourceItemId'), '');
    task_title := nullif(btrim(task_payload ->> 'title'), '');
    task_hours := round(coalesce((task_payload ->> 'budgetedHours')::numeric, 0), 2);

    if task_kind not in ('room', 'exterior', 'washing', 'custom')
      or task_item_id is null
      or task_title is null
      or task_hours < 0 then
      raise exception 'One or more calculator tasks are invalid' using errcode = '22023';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(requested_project_id, 0));

  perform 1
  from public.companycam_projects project
  where project.companycam_id = requested_project_id
  limit 1;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  -- Persist the calculator document itself.
  insert into public.project_calculators (
    companycam_project_id,
    doc,
    updated_by,
    updated_at
  ) values (
    requested_project_id,
    calculator_doc,
    auth.uid(),
    timezone('utc', now())
  )
  on conflict on constraint project_calculators_pkey do update
  set doc = excluded.doc,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

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
      requested_quote_id,
      coalesce(nullif(btrim(quote_payload ->> 'name'), ''), 'Quote'),
      coalesce(nullif(quote_payload ->> 'updatedAt', '')::timestamptz, timezone('utc', now())),
      nullif(btrim(quote_payload ->> 'notes'), ''),
      0,
      0,
      coalesce(max(budget.revision), 0) + 1,
      true,
      auth.uid(),
      timezone('utc', now())
    from public.project_labour_budgets budget
    where budget.companycam_project_id = requested_project_id
    returning * into active_budget;
  else
    -- Record which quote was transferred last, without touching tasks.
    update public.project_labour_budgets budget
    set source_quote_id = requested_quote_id,
        source_quote_name = coalesce(nullif(btrim(quote_payload ->> 'name'), ''), 'Quote'),
        source_quote_updated_at = coalesce(
          nullif(quote_payload ->> 'updatedAt', '')::timestamptz,
          timezone('utc', now())
        ),
        published_by = auth.uid(),
        published_at = timezone('utc', now())
    where budget.id = active_budget.id;
  end if;

  select coalesce(max(task.sort_order), 0)
  into next_sort
  from public.project_labour_tasks task
  where task.companycam_project_id = requested_project_id
    and task.is_active = true;

  for task_payload in
    select value from jsonb_array_elements(task_payloads)
  loop
    task_kind := task_payload ->> 'sourceKind';
    task_item_id := btrim(task_payload ->> 'sourceItemId');
    task_title := btrim(task_payload ->> 'title');
    task_hours := round(coalesce((task_payload ->> 'budgetedHours')::numeric, 0), 2);
    task_metadata := coalesce(task_payload -> 'metadata', '{}'::jsonb);
    if jsonb_typeof(task_metadata) <> 'object' then
      task_metadata := '{}'::jsonb;
    end if;

    select
      progress.id,
      progress.status,
      progress.completed_by,
      progress.completed_at
    into
      task_progress_id,
      task_status,
      task_completed_by,
      task_completed_at
    from public.project_labour_task_progress progress
    where progress.companycam_project_id = requested_project_id
      and progress.source_kind = task_kind
      and progress.source_item_id = task_item_id;

    if not found then
      insert into public.project_labour_task_progress (
        companycam_project_id,
        source_kind,
        source_item_id
      ) values (
        requested_project_id,
        task_kind,
        task_item_id
      )
      returning id, status, completed_by, completed_at
      into task_progress_id, task_status, task_completed_by, task_completed_at;
    end if;

    select task.id
    into existing_task_id
    from public.project_labour_tasks task
    where task.companycam_project_id = requested_project_id
      and task.progress_id = task_progress_id
      and task.is_active = true
    limit 1;

    if existing_task_id is not null then
      -- Update in place: title/notes/calculated hours refresh, manual hour
      -- overrides and painter status stay as they are.
      update public.project_labour_tasks task
      set title = task_title,
          notes = nullif(btrim(task_payload ->> 'notes'), ''),
          calculated_hours = task_hours,
          metadata = task_metadata,
          labour_budget_id = active_budget.id,
          budget_revision = active_budget.revision
      where task.id = existing_task_id;
    else
      next_sort := next_sort + 1;
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
        metadata,
        completed_by,
        completed_at
      ) values (
        active_budget.id,
        task_progress_id,
        requested_project_id,
        requested_quote_id,
        task_kind,
        task_item_id,
        task_title,
        nullif(btrim(task_payload ->> 'notes'), ''),
        task_hours,
        null,
        task_hours,
        next_sort,
        task_status,
        true,
        active_budget.revision,
        task_metadata,
        task_completed_by,
        task_completed_at
      );
    end if;
  end loop;

  -- Reload after the task trigger refreshed the totals.
  select budget.*
  into active_budget
  from public.project_labour_budgets budget
  where budget.id = active_budget.id;

  insert into public.project_budgets (
    companycam_project_id,
    budgeted_hours,
    updated_by
  ) values (
    requested_project_id,
    active_budget.budgeted_hours,
    auth.uid()
  )
  on conflict on constraint project_budgets_pkey do update
  set budgeted_hours = excluded.budgeted_hours,
      updated_by = excluded.updated_by;

  return query
  select
    active_budget.id,
    active_budget.companycam_project_id,
    active_budget.source_quote_id,
    active_budget.source_quote_name,
    active_budget.source_quote_updated_at,
    active_budget.budgeted_hours,
    jsonb_array_length(task_payloads),
    active_budget.revision,
    active_budget.published_at;
end;
$$;

revoke all on function public.transfer_project_calculator_tasks(text, jsonb, text, jsonb) from public, anon;
grant execute on function public.transfer_project_calculator_tasks(text, jsonb, text, jsonb) to authenticated;;
