-- Keep calculator-derived labour hours intact while allowing managers to set
-- job-specific painter-hour overrides. The existing budgeted_hours columns
-- remain the effective values consumed by the mobile app and legacy queries.

alter table public.project_labour_budgets
  add column calculated_hours numeric(10, 2);

update public.project_labour_budgets
set calculated_hours = budgeted_hours
where calculated_hours is null;

alter table public.project_labour_budgets
  alter column calculated_hours set not null,
  add constraint project_labour_budgets_calculated_hours_check
    check (calculated_hours >= 0);

comment on column public.project_labour_budgets.calculated_hours is
  'Original total hours calculated from the published quote before task-level manual overrides.';

alter table public.project_labour_tasks
  add column calculated_hours numeric(10, 2),
  add column manual_budgeted_hours numeric(10, 2)
    check (manual_budgeted_hours is null or manual_budgeted_hours >= 0);

update public.project_labour_tasks
set calculated_hours = budgeted_hours
where calculated_hours is null;

alter table public.project_labour_tasks
  alter column calculated_hours set not null,
  add constraint project_labour_tasks_calculated_hours_check
    check (calculated_hours >= 0);

comment on column public.project_labour_tasks.calculated_hours is
  'Immutable-for-the-revision calculator result used by Reset. A new publication may recalculate it.';

comment on column public.project_labour_tasks.manual_budgeted_hours is
  'Optional manager override. Null means the effective budgeted_hours equals calculated_hours.';

comment on column public.project_labour_tasks.budgeted_hours is
  'Effective painter budget: manual_budgeted_hours when present, otherwise calculated_hours.';

create index project_labour_tasks_manual_override_source_idx
  on public.project_labour_tasks(
    companycam_project_id,
    source_quote_id,
    source_kind,
    source_item_id,
    budget_revision desc
  );

create or replace function public.sync_project_labour_task_budget_hours()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.calculated_hours is distinct from old.calculated_hours then
    raise exception 'Calculated task hours require a new budget revision'
      using errcode = '22023';
  end if;

  if new.calculated_hours is null or new.calculated_hours < 0 then
    raise exception 'Calculated task hours must be zero or greater'
      using errcode = '22023';
  end if;

  if new.manual_budgeted_hours is not null
    and new.manual_budgeted_hours < 0 then
    raise exception 'Manual task hours must be zero or greater'
      using errcode = '22023';
  end if;

  new.calculated_hours := round(new.calculated_hours, 2);
  new.manual_budgeted_hours := case
    when new.manual_budgeted_hours is null then null
    else round(new.manual_budgeted_hours, 2)
  end;
  new.budgeted_hours := coalesce(
    new.manual_budgeted_hours,
    new.calculated_hours
  );
  return new;
end;
$$;

revoke all on function public.sync_project_labour_task_budget_hours()
  from public, anon, authenticated;

drop trigger if exists sync_project_labour_task_budget_hours
  on public.project_labour_tasks;
create trigger sync_project_labour_task_budget_hours
before insert or update of calculated_hours, manual_budgeted_hours, budgeted_hours
on public.project_labour_tasks
for each row execute function public.sync_project_labour_task_budget_hours();

create or replace function public.recalculate_project_labour_budget_hours(
  requested_budget_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_budget_id is null then
    return;
  end if;

  update public.project_labour_budgets budget
  set budgeted_hours = coalesce((
    select round(sum(task.budgeted_hours), 2)
    from public.project_labour_tasks task
    where task.labour_budget_id = requested_budget_id
  ), 0)
  where budget.id = requested_budget_id;

  update public.project_budgets legacy
  set budgeted_hours = budget.budgeted_hours,
      updated_by = coalesce(auth.uid(), legacy.updated_by)
  from public.project_labour_budgets budget
  where budget.id = requested_budget_id
    and budget.is_active = true
    and legacy.companycam_project_id = budget.companycam_project_id;
end;
$$;

revoke all on function public.recalculate_project_labour_budget_hours(uuid)
  from public, anon, authenticated;

create or replace function public.refresh_project_labour_budget_after_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalculate_project_labour_budget_hours(old.labour_budget_id);
    return old;
  end if;

  if tg_op = 'UPDATE'
    and old.labour_budget_id is distinct from new.labour_budget_id then
    perform public.recalculate_project_labour_budget_hours(old.labour_budget_id);
  end if;

  perform public.recalculate_project_labour_budget_hours(new.labour_budget_id);
  return new;
end;
$$;

revoke all on function public.refresh_project_labour_budget_after_task_change()
  from public, anon, authenticated;

drop trigger if exists refresh_project_labour_budget_after_task_change
  on public.project_labour_tasks;
create trigger refresh_project_labour_budget_after_task_change
after insert or delete or update of
  labour_budget_id,
  calculated_hours,
  manual_budgeted_hours,
  budgeted_hours
on public.project_labour_tasks
for each row execute function public.refresh_project_labour_budget_after_task_change();

create or replace function public.publish_project_labour_budget(
  requested_project_id text,
  calculator_doc jsonb,
  requested_quote_id text,
  task_payloads jsonb
)
returns table (
  labour_budget_id uuid,
  companycam_project_id text,
  source_quote_id text,
  source_quote_name text,
  source_quote_updated_at timestamptz,
  budgeted_hours numeric,
  task_count integer,
  revision integer,
  published_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  quote_payload jsonb;
  task_payload jsonb;
  task_kind text;
  task_item_id text;
  task_title text;
  task_hours numeric;
  task_manual_hours numeric;
  task_metadata jsonb;
  total_calculated_hours numeric := 0;
  next_revision integer;
  published_budget public.project_labour_budgets%rowtype;
begin
  if auth.uid() is null
    or public.current_employee_role() not in ('admin', 'manager') then
    raise exception 'Only active admins and managers can publish labour budgets'
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
    raise exception 'Labour budget tasks must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(task_payloads) > 500 then
    raise exception 'A labour budget is limited to 500 tasks'
      using errcode = '22023';
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
      raise exception 'One or more labour tasks are invalid'
        using errcode = '22023';
    end if;

    total_calculated_hours := total_calculated_hours + task_hours;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(requested_project_id, 0));
  perform 1
  from public.companycam_projects project
  where project.companycam_id = requested_project_id
  limit 1;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  select coalesce(max(budget.revision), 0) + 1
  into next_revision
  from public.project_labour_budgets budget
  where budget.companycam_project_id = requested_project_id;

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

  update public.project_labour_budgets budget
  set is_active = false
  where budget.companycam_project_id = requested_project_id
    and budget.is_active = true;

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
  ) values (
    requested_project_id,
    requested_quote_id,
    coalesce(nullif(btrim(quote_payload ->> 'name'), ''), 'Quote'),
    coalesce(nullif(quote_payload ->> 'updatedAt', '')::timestamptz, timezone('utc', now())),
    nullif(btrim(quote_payload ->> 'notes'), ''),
    round(total_calculated_hours, 2),
    round(total_calculated_hours, 2),
    next_revision,
    true,
    auth.uid(),
    timezone('utc', now())
  )
  returning * into published_budget;

  insert into public.project_budgets (
    companycam_project_id,
    budgeted_hours,
    updated_by
  ) values (
    requested_project_id,
    published_budget.budgeted_hours,
    auth.uid()
  )
  on conflict on constraint project_budgets_pkey do update
  set budgeted_hours = excluded.budgeted_hours,
      updated_by = excluded.updated_by;

  update public.project_labour_tasks
  set is_active = false
  where project_labour_tasks.companycam_project_id = requested_project_id
    and is_active = true;

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

    select previous.manual_budgeted_hours
    into task_manual_hours
    from public.project_labour_tasks previous
    where previous.companycam_project_id = requested_project_id
      and previous.source_quote_id = requested_quote_id
      and previous.source_kind = task_kind
      and previous.source_item_id = task_item_id
    order by previous.budget_revision desc, previous.inserted_at desc
    limit 1;

    insert into public.project_labour_tasks (
      labour_budget_id,
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
      is_active,
      budget_revision,
      metadata
    ) values (
      published_budget.id,
      requested_project_id,
      requested_quote_id,
      task_kind,
      task_item_id,
      task_title,
      nullif(btrim(task_payload ->> 'notes'), ''),
      task_hours,
      task_manual_hours,
      coalesce(task_manual_hours, task_hours),
      coalesce((task_payload ->> 'sortOrder')::integer, 0),
      true,
      published_budget.revision,
      task_metadata
    );
  end loop;

  select budget.*
  into published_budget
  from public.project_labour_budgets budget
  where budget.id = published_budget.id;

  return query
  select
    published_budget.id,
    published_budget.companycam_project_id,
    published_budget.source_quote_id,
    published_budget.source_quote_name,
    published_budget.source_quote_updated_at,
    published_budget.budgeted_hours,
    jsonb_array_length(task_payloads),
    published_budget.revision,
    published_budget.published_at;
end;
$$;

comment on function public.publish_project_labour_budget(text, jsonb, text, jsonb) is
  'Publishes calculated task hours and carries quote-specific manual overrides forward by stable task source ID.';

revoke all on function public.publish_project_labour_budget(text, jsonb, text, jsonb)
  from public, anon;
grant execute on function public.publish_project_labour_budget(text, jsonb, text, jsonb)
  to authenticated;

create or replace function public.set_project_labour_task_budget_hours(
  requested_project_id text,
  requested_task_id uuid,
  requested_budgeted_hours numeric default null
)
returns table (
  task_id uuid,
  calculated_hours numeric,
  manual_budgeted_hours numeric,
  budgeted_hours numeric,
  total_budgeted_hours numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_task public.project_labour_tasks%rowtype;
begin
  if auth.uid() is null
    or public.current_employee_role() not in ('admin', 'manager') then
    raise exception 'Only active admins and managers can change task budgets'
      using errcode = '42501';
  end if;

  if requested_budgeted_hours is not null
    and requested_budgeted_hours < 0 then
    raise exception 'Task hours must be zero or greater'
      using errcode = '22023';
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
  set manual_budgeted_hours = case
    when requested_budgeted_hours is null then null
    else round(requested_budgeted_hours, 2)
  end
  where task.id = requested_task_id;

  return query
  select
    task.id,
    task.calculated_hours,
    task.manual_budgeted_hours,
    task.budgeted_hours,
    budget.budgeted_hours
  from public.project_labour_tasks task
  join public.project_labour_budgets budget
    on budget.id = task.labour_budget_id
  where task.id = requested_task_id;
end;
$$;

comment on function public.set_project_labour_task_budget_hours(text, uuid, numeric) is
  'Manager-only task-hour override. Passing null resets effective hours to the stored calculated value.';

revoke all on function public.set_project_labour_task_budget_hours(text, uuid, numeric)
  from public, anon;
grant execute on function public.set_project_labour_task_budget_hours(text, uuid, numeric)
  to authenticated;
