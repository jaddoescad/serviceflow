-- Publish one calculator quote per CompanyCam job as the active labour budget.
-- Calculator pricing remains manager-only. Assigned painters receive only the
-- task names, instructions, budgeted hours, checklist state, and aggregate
-- task time that the mobile app needs.

create extension if not exists pgcrypto;

create table public.project_labour_budgets (
  id uuid primary key default gen_random_uuid(),
  companycam_project_id text not null
    references public.companycam_projects(companycam_id) on delete cascade,
  source_quote_id text not null,
  source_quote_name text not null,
  source_quote_updated_at timestamptz not null,
  instructions text,
  budgeted_hours numeric(10, 2) not null
    check (budgeted_hours >= 0),
  revision integer not null default 1
    check (revision > 0),
  is_active boolean not null default true,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default timezone('utc', now()),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, companycam_project_id),
  unique (companycam_project_id, revision)
);

comment on table public.project_labour_budgets is
  'Versioned calculator quotes published as labour budgets. A partial unique index allows exactly one active budget per job; rows contain painter-safe summary data only.';

create unique index project_labour_budgets_one_active_per_project_idx
  on public.project_labour_budgets(companycam_project_id)
  where is_active;

create table public.project_labour_tasks (
  id uuid primary key default gen_random_uuid(),
  labour_budget_id uuid not null,
  companycam_project_id text not null,
  source_quote_id text not null,
  source_kind text not null
    check (source_kind in ('room', 'exterior', 'washing', 'custom')),
  source_item_id text not null,
  title text not null check (btrim(title) <> ''),
  notes text,
  budgeted_hours numeric(10, 2) not null default 0
    check (budgeted_hours >= 0),
  sort_order integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'skipped')),
  is_active boolean not null default true,
  budget_revision integer not null check (budget_revision > 0),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint project_labour_tasks_budget_project_fkey
    foreign key (labour_budget_id, companycam_project_id)
    references public.project_labour_budgets(id, companycam_project_id)
    on delete cascade,
  constraint project_labour_tasks_source_key
    unique (labour_budget_id, source_kind, source_item_id)
);

comment on table public.project_labour_tasks is
  'Versioned painter checklist snapshots from calculator rooms and exterior lines. Inactive rows retain checklist and time history when another quote becomes the budget.';

create index project_labour_tasks_active_project_order_idx
  on public.project_labour_tasks(companycam_project_id, is_active, sort_order);

create index project_labour_tasks_budget_idx
  on public.project_labour_tasks(labour_budget_id);

create table public.project_labour_task_time_entries (
  id uuid primary key default gen_random_uuid(),
  client_entry_id text not null unique,
  task_id uuid not null
    references public.project_labour_tasks(id) on delete restrict,
  user_id uuid not null
    references auth.users(id) on delete restrict,
  time_entry_id uuid
    references public.time_entries(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'complete')),
  notes text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint project_labour_task_time_range_check
    check (ended_at is null or ended_at >= started_at),
  constraint project_labour_task_time_status_check
    check (
      (status = 'active' and ended_at is null)
      or (status = 'complete' and ended_at is not null)
    )
);

comment on table public.project_labour_task_time_entries is
  'Offline-safe painter task timers. Optional time_entry_id ties task time to the existing whole-shift record without changing that record.';

create index project_labour_task_time_task_started_idx
  on public.project_labour_task_time_entries(task_id, started_at desc);

create index project_labour_task_time_user_started_idx
  on public.project_labour_task_time_entries(user_id, started_at desc);

create unique index project_labour_task_time_one_active_per_user_idx
  on public.project_labour_task_time_entries(user_id)
  where ended_at is null;

drop trigger if exists set_project_labour_budgets_updated_at
  on public.project_labour_budgets;
create trigger set_project_labour_budgets_updated_at
before update on public.project_labour_budgets
for each row execute function public.set_updated_at();

drop trigger if exists set_project_labour_tasks_updated_at
  on public.project_labour_tasks;
create trigger set_project_labour_tasks_updated_at
before update on public.project_labour_tasks
for each row execute function public.set_updated_at();

drop trigger if exists set_project_labour_task_time_updated_at
  on public.project_labour_task_time_entries;
create trigger set_project_labour_task_time_updated_at
before update on public.project_labour_task_time_entries
for each row execute function public.set_updated_at();

create or replace function public.can_access_project_labour_job(
  requested_project_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employee_profiles profile
    where profile.user_id = auth.uid()
      and profile.is_active = true
      and (
        profile.role in ('admin', 'manager')
        or exists (
          select 1
          from public.project_assignments assignment
          where assignment.companycam_project_id = requested_project_id
            and assignment.user_id = auth.uid()
            and assignment.status = 'active'
        )
      )
  )
$$;

comment on function public.can_access_project_labour_job(text) is
  'True for active managers or painters actively assigned to the requested job.';

revoke all on function public.can_access_project_labour_job(text)
  from public, anon;
grant execute on function public.can_access_project_labour_job(text)
  to authenticated;

alter table public.project_labour_budgets enable row level security;
alter table public.project_labour_tasks enable row level security;
alter table public.project_labour_task_time_entries enable row level security;

create policy "Assigned crew can read project labour budgets"
on public.project_labour_budgets
for select
to authenticated
using (
  public.can_access_project_labour_job(companycam_project_id)
  and (is_active or public.current_employee_role() in ('admin', 'manager'))
);

create policy "Managers can insert project labour budgets"
on public.project_labour_budgets
for insert
to authenticated
with check (public.current_employee_role() in ('admin', 'manager'));

create policy "Managers can update project labour budgets"
on public.project_labour_budgets
for update
to authenticated
using (public.current_employee_role() in ('admin', 'manager'))
with check (public.current_employee_role() in ('admin', 'manager'));

create policy "Managers can delete project labour budgets"
on public.project_labour_budgets
for delete
to authenticated
using (public.current_employee_role() in ('admin', 'manager'));

create policy "Assigned crew can read active project labour tasks"
on public.project_labour_tasks
for select
to authenticated
using (
  public.can_access_project_labour_job(companycam_project_id)
  and (is_active or public.current_employee_role() in ('admin', 'manager'))
);

create policy "Managers can insert project labour tasks"
on public.project_labour_tasks
for insert
to authenticated
with check (public.current_employee_role() in ('admin', 'manager'));

create policy "Managers can update project labour tasks"
on public.project_labour_tasks
for update
to authenticated
using (public.current_employee_role() in ('admin', 'manager'))
with check (public.current_employee_role() in ('admin', 'manager'));

create policy "Managers can delete project labour tasks"
on public.project_labour_tasks
for delete
to authenticated
using (public.current_employee_role() in ('admin', 'manager'));

create policy "Painters can read own task time and managers can read all"
on public.project_labour_task_time_entries
for select
to authenticated
using (
  user_id = auth.uid()
  or public.current_employee_role() in ('admin', 'manager')
);

create policy "Painters can start own assigned task timers"
on public.project_labour_task_time_entries
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.project_labour_tasks task
    where task.id = task_id
      and task.is_active = true
      and public.can_access_project_labour_job(task.companycam_project_id)
  )
);

create policy "Painters can update own task timers"
on public.project_labour_task_time_entries
for update
to authenticated
using (
  user_id = auth.uid()
  or public.current_employee_role() in ('admin', 'manager')
)
with check (
  user_id = auth.uid()
  or public.current_employee_role() in ('admin', 'manager')
);

create or replace function public.protect_project_labour_task_time_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_entry_id is distinct from old.client_entry_id
    or new.task_id is distinct from old.task_id
    or new.user_id is distinct from old.user_id
    or new.started_at is distinct from old.started_at then
    raise exception 'Task timer identity fields cannot be changed'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_project_labour_task_time_identity
  on public.project_labour_task_time_entries;
create trigger protect_project_labour_task_time_identity
before update on public.project_labour_task_time_entries
for each row execute function public.protect_project_labour_task_time_identity();

create policy "Managers can delete task timers"
on public.project_labour_task_time_entries
for delete
to authenticated
using (public.current_employee_role() in ('admin', 'manager'));

grant select, insert, update, delete
  on public.project_labour_budgets,
     public.project_labour_tasks,
     public.project_labour_task_time_entries
  to authenticated;

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
  task_metadata jsonb;
  total_hours numeric := 0;
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

    total_hours := total_hours + task_hours;
  end loop;

  -- Serialize publications for one job so concurrent clicks cannot create two
  -- active budgets or reuse the same revision number.
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
    round(total_hours, 2),
    next_revision,
    true,
    auth.uid(),
    timezone('utc', now())
  )
  returning * into published_budget;

  -- Keep the legacy aggregate field synchronized for existing admin queries.
  -- The selected quote and task rows remain the authoritative budget source.
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

    insert into public.project_labour_tasks (
      labour_budget_id,
      companycam_project_id,
      source_quote_id,
      source_kind,
      source_item_id,
      title,
      notes,
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
      coalesce((task_payload ->> 'sortOrder')::integer, 0),
      true,
      published_budget.revision,
      task_metadata
    );
  end loop;

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
  'Atomically saves the calculator, selects one quote per job, synchronizes aggregate hours, and materializes painter-safe checklist tasks.';

revoke all on function public.publish_project_labour_budget(text, jsonb, text, jsonb)
  from public, anon;
grant execute on function public.publish_project_labour_budget(text, jsonb, text, jsonb)
  to authenticated;

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
    task.status,
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
  left join public.project_labour_task_time_entries timer
    on timer.task_id = task.id
  where budget.companycam_project_id = requested_project_id
  group by budget.id, task.id
  order by task.sort_order, task.inserted_at, task.id;
end;
$$;

comment on function public.list_project_labour_tasks(text) is
  'Painter-safe active checklist and aggregate team time for an assigned job. It never returns calculator pricing or rates.';

revoke all on function public.list_project_labour_tasks(text)
  from public, anon;
grant execute on function public.list_project_labour_tasks(text)
  to authenticated;

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
begin
  if requested_status is null
    or requested_status not in ('pending', 'in_progress', 'completed', 'skipped') then
    raise exception 'Invalid task status' using errcode = '22023';
  end if;

  select task.companycam_project_id
  into task_project_id
  from public.project_labour_tasks task
  where task.id = requested_task_id
    and task.is_active = true;

  if task_project_id is null then
    raise exception 'Active task not found' using errcode = 'P0002';
  end if;

  if not public.can_access_project_labour_job(task_project_id) then
    raise exception 'You are not assigned to this project'
      using errcode = '42501';
  end if;

  return query
  update public.project_labour_tasks task
  set status = requested_status,
      completed_by = case when requested_status = 'completed' then auth.uid() else null end,
      completed_at = case when requested_status = 'completed' then timezone('utc', now()) else null end
  where task.id = requested_task_id
  returning task.id, task.status, task.completed_at;
end;
$$;

comment on function public.set_project_labour_task_status(uuid, text) is
  'Lets assigned painters update checklist state without granting access to edit task budgets or definitions.';

revoke all on function public.set_project_labour_task_status(uuid, text)
  from public, anon;
grant execute on function public.set_project_labour_task_status(uuid, text)
  to authenticated;
