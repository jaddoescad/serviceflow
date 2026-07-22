-- Keep painter progress stable when calculator task snapshots are republished.
-- Budget/task rows remain versioned for audit history, while checklist state
-- and timer aggregation follow a permanent job-item identity.

create table public.project_labour_task_progress (
  id uuid primary key default gen_random_uuid(),
  companycam_project_id text not null
    references public.companycam_projects(companycam_id) on delete cascade,
  source_kind text not null
    check (source_kind in ('room', 'exterior', 'washing', 'custom')),
  source_item_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'skipped')),
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, companycam_project_id),
  unique (companycam_project_id, source_kind, source_item_id),
  constraint project_labour_task_progress_completion_check
    check (
      (status = 'completed' and completed_at is not null)
      or (status <> 'completed' and completed_at is null)
    )
);

comment on table public.project_labour_task_progress is
  'Permanent checklist identity for one physical job item. Status and timer history survive calculator budget revisions and default-quote switches.';

-- Recover the most meaningful existing checklist state for each stable item.
-- A prior non-pending state wins over a newer auto-created pending snapshot.
insert into public.project_labour_task_progress (
  companycam_project_id,
  source_kind,
  source_item_id,
  status,
  completed_by,
  completed_at,
  inserted_at,
  updated_at
)
select
  chosen.companycam_project_id,
  chosen.source_kind,
  chosen.source_item_id,
  chosen.status,
  case when chosen.status = 'completed' then chosen.completed_by else null end,
  case
    when chosen.status = 'completed' then coalesce(chosen.completed_at, chosen.updated_at)
    else null
  end,
  chosen.inserted_at,
  chosen.updated_at
from (
  select distinct on (
    task.companycam_project_id,
    task.source_kind,
    task.source_item_id
  )
    task.companycam_project_id,
    task.source_kind,
    task.source_item_id,
    task.status,
    task.completed_by,
    task.completed_at,
    task.inserted_at,
    task.updated_at
  from public.project_labour_tasks task
  order by
    task.companycam_project_id,
    task.source_kind,
    task.source_item_id,
    (task.status <> 'pending') desc,
    coalesce(task.completed_at, task.updated_at) desc,
    task.budget_revision desc
) chosen;

alter table public.project_labour_tasks
  add column progress_id uuid;

update public.project_labour_tasks task
set progress_id = progress.id
from public.project_labour_task_progress progress
where progress.companycam_project_id = task.companycam_project_id
  and progress.source_kind = task.source_kind
  and progress.source_item_id = task.source_item_id;

alter table public.project_labour_tasks
  alter column progress_id set not null,
  add constraint project_labour_tasks_progress_project_fkey
    foreign key (progress_id, companycam_project_id)
    references public.project_labour_task_progress(id, companycam_project_id)
    on delete restrict;

create index project_labour_tasks_progress_idx
  on public.project_labour_tasks(progress_id, is_active, budget_revision desc);

alter table public.project_labour_task_time_entries
  add column progress_id uuid;

update public.project_labour_task_time_entries timer
set progress_id = task.progress_id
from public.project_labour_tasks task
where task.id = timer.task_id;

alter table public.project_labour_task_time_entries
  alter column progress_id set not null,
  add constraint project_labour_task_time_progress_fkey
    foreign key (progress_id)
    references public.project_labour_task_progress(id)
    on delete restrict;

create index project_labour_task_time_progress_started_idx
  on public.project_labour_task_time_entries(progress_id, started_at desc);

drop trigger if exists set_project_labour_task_progress_updated_at
  on public.project_labour_task_progress;
create trigger set_project_labour_task_progress_updated_at
before update on public.project_labour_task_progress
for each row execute function public.set_updated_at();

alter table public.project_labour_task_progress enable row level security;

create policy "Managers can read project labour task progress"
on public.project_labour_task_progress
for select
to authenticated
using (public.current_employee_role() in ('admin', 'manager'));

create policy "Managers can insert project labour task progress"
on public.project_labour_task_progress
for insert
to authenticated
with check (public.current_employee_role() in ('admin', 'manager'));

create policy "Managers can update project labour task progress"
on public.project_labour_task_progress
for update
to authenticated
using (public.current_employee_role() in ('admin', 'manager'))
with check (public.current_employee_role() in ('admin', 'manager'));

create policy "Managers can delete project labour task progress"
on public.project_labour_task_progress
for delete
to authenticated
using (public.current_employee_role() in ('admin', 'manager'));

grant select, insert, update, delete
  on public.project_labour_task_progress
  to authenticated;

create or replace function public.can_start_project_labour_task_timer(
  requested_task_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_labour_tasks requested
    join public.project_labour_tasks active
      on active.progress_id = requested.progress_id
     and active.companycam_project_id = requested.companycam_project_id
     and active.is_active = true
    where requested.id = requested_task_id
      and public.can_access_project_labour_job(requested.companycam_project_id)
  )
$$;

comment on function public.can_start_project_labour_task_timer(uuid) is
  'Allows an offline timer operation from an older task revision when the same stable task is still active.';

revoke all on function public.can_start_project_labour_task_timer(uuid)
  from public, anon;
grant execute on function public.can_start_project_labour_task_timer(uuid)
  to authenticated;

drop policy if exists "Painters can start own assigned task timers"
  on public.project_labour_task_time_entries;
create policy "Painters can start own assigned task timers"
on public.project_labour_task_time_entries
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.can_start_project_labour_task_timer(task_id)
);

create or replace function public.assign_project_labour_task_timer_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select task.progress_id
  into new.progress_id
  from public.project_labour_tasks task
  where task.id = new.task_id;

  if new.progress_id is null then
    raise exception 'Painter task progress identity not found'
      using errcode = 'P0002';
  end if;

  return new;
end;
$$;

revoke all on function public.assign_project_labour_task_timer_progress()
  from public, anon, authenticated;

drop trigger if exists assign_project_labour_task_timer_progress
  on public.project_labour_task_time_entries;
create trigger assign_project_labour_task_timer_progress
before insert on public.project_labour_task_time_entries
for each row execute function public.assign_project_labour_task_timer_progress();

create or replace function public.protect_project_labour_task_time_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_entry_id is distinct from old.client_entry_id
    or new.task_id is distinct from old.task_id
    or new.progress_id is distinct from old.progress_id
    or new.user_id is distinct from old.user_id
    or new.started_at is distinct from old.started_at then
    raise exception 'Task timer identity fields cannot be changed'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

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
  task_progress_id uuid;
  task_status text;
  task_completed_by uuid;
  task_completed_at timestamptz;
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

  -- Never strand a running timer by publishing a scope that omits its stable
  -- task identity. Timers for tasks still present survive the new revision.
  if exists (
    select 1
    from public.project_labour_task_time_entries timer
    join public.project_labour_task_progress progress
      on progress.id = timer.progress_id
    where progress.companycam_project_id = requested_project_id
      and timer.ended_at is null
      and not exists (
        select 1
        from jsonb_array_elements(task_payloads) candidate(value)
        where candidate.value ->> 'sourceKind' = progress.source_kind
          and candidate.value ->> 'sourceItemId' = progress.source_item_id
      )
  ) then
    raise exception 'A painter is timing a task that is not in this calculator. Stop that task timer before changing the default.'
      using errcode = '55000';
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

  update public.project_labour_tasks task
  set is_active = false
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
      returning
        id,
        status,
        completed_by,
        completed_at
      into
        task_progress_id,
        task_status,
        task_completed_by,
        task_completed_at;
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
      published_budget.id,
      task_progress_id,
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
      task_status,
      true,
      published_budget.revision,
      task_metadata,
      task_completed_by,
      task_completed_at
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
  'Publishes versioned task definitions while preserving stable checklist progress, timer history, and quote-specific manual hour overrides.';

create or replace function public.list_project_labour_tasks(
  requested_project_id text
)
returns table (
  labour_budget_id uuid,
  companycam_project_id text,
  source_quote_id text,
  source_quote_name text,
  instructions text,
  total_budgeted_hours numeric,
  budget_revision integer,
  published_at timestamptz,
  task_id uuid,
  source_kind text,
  title text,
  notes text,
  task_budgeted_hours numeric,
  hours_spent numeric,
  status text,
  sort_order integer,
  metadata jsonb,
  my_active_started_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_access_project_labour_job(requested_project_id) then
    raise exception 'You are not assigned to this project'
      using errcode = '42501';
  end if;

  return query
  select
    budget.id,
    budget.companycam_project_id,
    budget.source_quote_id,
    budget.source_quote_name,
    budget.instructions,
    budget.budgeted_hours,
    budget.revision,
    budget.published_at,
    task.id,
    task.source_kind,
    task.title,
    task.notes,
    task.budgeted_hours,
    round(
      coalesce(sum(
        greatest(
          extract(epoch from (coalesce(timer.ended_at, now()) - timer.started_at)) / 3600.0,
          0
        )
      ), 0)::numeric,
      2
    ),
    progress.status,
    task.sort_order,
    task.metadata,
    max(timer.started_at) filter (
      where timer.user_id = auth.uid() and timer.ended_at is null
    )
  from public.project_labour_budgets budget
  join public.project_labour_tasks task
    on task.labour_budget_id = budget.id
   and task.companycam_project_id = budget.companycam_project_id
   and task.is_active = true
  join public.project_labour_task_progress progress
    on progress.id = task.progress_id
   and progress.companycam_project_id = task.companycam_project_id
  left join public.project_labour_task_time_entries timer
    on timer.progress_id = progress.id
  where budget.companycam_project_id = requested_project_id
    and budget.is_active = true
  group by budget.id, task.id, progress.id
  order by task.sort_order, task.inserted_at, task.id;
end;
$$;

comment on function public.list_project_labour_tasks(text) is
  'Painter-safe active checklist with status and team time aggregated across all revisions of each stable task identity.';

create or replace function public.set_project_labour_task_status(
  requested_task_id uuid,
  requested_status text
)
returns table (
  task_id uuid,
  status text,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_project_id text;
  task_progress_id uuid;
begin
  if requested_status is null
    or requested_status not in ('pending', 'in_progress', 'completed', 'skipped') then
    raise exception 'Invalid task status' using errcode = '22023';
  end if;

  select task.companycam_project_id, task.progress_id
  into task_project_id, task_progress_id
  from public.project_labour_tasks task
  where task.id = requested_task_id;

  if task_project_id is null or task_progress_id is null then
    raise exception 'Painter task not found' using errcode = 'P0002';
  end if;

  if not public.can_access_project_labour_job(task_project_id) then
    raise exception 'You are not assigned to this project'
      using errcode = '42501';
  end if;

  update public.project_labour_task_progress progress
  set status = requested_status,
      completed_by = case when requested_status = 'completed' then auth.uid() else null end,
      completed_at = case when requested_status = 'completed' then timezone('utc', now()) else null end
  where progress.id = task_progress_id;

  -- Keep the active materialized row readable for manager-side diagnostics;
  -- the permanent progress row remains authoritative.
  update public.project_labour_tasks task
  set status = requested_status,
      completed_by = case when requested_status = 'completed' then auth.uid() else null end,
      completed_at = case when requested_status = 'completed' then timezone('utc', now()) else null end
  where task.progress_id = task_progress_id
    and task.is_active = true;

  return query
  select
    requested_task_id,
    progress.status,
    progress.completed_at
  from public.project_labour_task_progress progress
  where progress.id = task_progress_id;
end;
$$;

comment on function public.set_project_labour_task_status(uuid, text) is
  'Updates stable checklist progress from any historical task revision so offline writes survive republishing.';

