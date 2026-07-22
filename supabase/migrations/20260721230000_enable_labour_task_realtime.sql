-- Publish painter-safe live task state without exposing raw timer history.
-- Assigned crew can subscribe to one job and receive a small UPDATE whenever
-- checklist status or the people actively timing a task changes.

create table public.project_labour_task_live_state (
  progress_id uuid primary key,
  companycam_project_id text not null,
  status text not null
    check (status in ('pending', 'in_progress', 'completed', 'skipped')),
  active_painters jsonb not null default '[]'::jsonb
    check (jsonb_typeof(active_painters) = 'array'),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint project_labour_task_live_state_progress_project_fkey
    foreign key (progress_id, companycam_project_id)
    references public.project_labour_task_progress(id, companycam_project_id)
    on delete cascade
);

comment on table public.project_labour_task_live_state is
  'Painter-safe realtime projection of stable task status and active painter names. Raw task timer history remains private.';

create index project_labour_task_live_state_project_idx
  on public.project_labour_task_live_state(companycam_project_id, progress_id);

create or replace function public.refresh_project_labour_task_live_state(
  requested_progress_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_project_id text;
  task_status text;
  live_painters jsonb;
begin
  select progress.companycam_project_id, progress.status
  into task_project_id, task_status
  from public.project_labour_task_progress progress
  where progress.id = requested_progress_id;

  if task_project_id is null then
    delete from public.project_labour_task_live_state state
    where state.progress_id = requested_progress_id;
    return;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', timer.user_id,
        'display_name', coalesce(
          nullif(btrim(profile.full_name), ''),
          nullif(split_part(coalesce(profile.email, ''), '@', 1), ''),
          'Painter'
        ),
        'started_at', timer.started_at
      )
      order by timer.started_at, timer.id
    ),
    '[]'::jsonb
  )
  into live_painters
  from public.project_labour_task_time_entries timer
  left join public.employee_profiles profile
    on profile.user_id = timer.user_id
  where timer.progress_id = requested_progress_id
    and timer.ended_at is null;

  insert into public.project_labour_task_live_state (
    progress_id,
    companycam_project_id,
    status,
    active_painters,
    updated_at
  ) values (
    requested_progress_id,
    task_project_id,
    task_status,
    live_painters,
    timezone('utc', now())
  )
  on conflict (progress_id) do update
  set companycam_project_id = excluded.companycam_project_id,
      status = excluded.status,
      active_painters = excluded.active_painters,
      updated_at = excluded.updated_at;
end;
$$;

comment on function public.refresh_project_labour_task_live_state(uuid) is
  'Refreshes the painter-safe realtime projection after status or timer changes.';

revoke all on function public.refresh_project_labour_task_live_state(uuid)
  from public, anon, authenticated;

create or replace function public.sync_project_labour_task_live_state_from_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_project_labour_task_live_state(new.id);
  return new;
end;
$$;

revoke all on function public.sync_project_labour_task_live_state_from_progress()
  from public, anon, authenticated;

drop trigger if exists sync_project_labour_task_live_state_from_progress
  on public.project_labour_task_progress;
create trigger sync_project_labour_task_live_state_from_progress
after insert or update of status on public.project_labour_task_progress
for each row execute function public.sync_project_labour_task_live_state_from_progress();

create or replace function public.sync_project_labour_task_live_state_from_timer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_project_labour_task_live_state(
    case when tg_op = 'DELETE' then old.progress_id else new.progress_id end
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.sync_project_labour_task_live_state_from_timer()
  from public, anon, authenticated;

drop trigger if exists sync_project_labour_task_live_state_from_timer
  on public.project_labour_task_time_entries;
create trigger sync_project_labour_task_live_state_from_timer
after insert or update or delete on public.project_labour_task_time_entries
for each row execute function public.sync_project_labour_task_live_state_from_timer();

-- Seed one stable row per task, including any timers already running when this
-- migration is applied.
do $$
declare
  progress_row record;
begin
  for progress_row in
    select progress.id
    from public.project_labour_task_progress progress
  loop
    perform public.refresh_project_labour_task_live_state(progress_row.id);
  end loop;
end;
$$;

alter table public.project_labour_task_live_state enable row level security;

create policy "Assigned crew can read live project labour task state"
on public.project_labour_task_live_state
for select
to authenticated
using (public.can_access_project_labour_job(companycam_project_id));

grant select on public.project_labour_task_live_state to authenticated;

create or replace function public.list_project_labour_tasks_live(
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
  my_active_started_at timestamptz,
  active_painters jsonb
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
    ),
    coalesce(live_state.active_painters, '[]'::jsonb)
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
  left join public.project_labour_task_live_state live_state
    on live_state.progress_id = progress.id
   and live_state.companycam_project_id = progress.companycam_project_id
  where budget.companycam_project_id = requested_project_id
    and budget.is_active = true
  group by budget.id, task.id, progress.id, live_state.active_painters
  order by task.sort_order, task.inserted_at, task.id;
end;
$$;

comment on function public.list_project_labour_tasks_live(text) is
  'Painter-safe active checklist, aggregate task time, and the names of painters currently timing each task.';

revoke all on function public.list_project_labour_tasks_live(text)
  from public, anon;
grant execute on function public.list_project_labour_tasks_live(text)
  to authenticated;

-- Supabase Realtime is opt-in per table. Keep the operation forward-only and
-- idempotent so this migration can run on local, staging, and production.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication publication
    where publication.pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables publication_table
    where publication_table.pubname = 'supabase_realtime'
      and publication_table.schemaname = 'public'
      and publication_table.tablename = 'project_labour_task_live_state'
  ) then
    alter publication supabase_realtime
      add table public.project_labour_task_live_state;
  end if;
end;
$$;
