-- Capture why a painter exceeded a task budget. The mobile client submits the
-- current versioned task row ID; a trigger resolves it to the permanent task
-- progress identity so answers survive calculator republishes.

create table public.project_labour_task_over_budget_reasons (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  task_id uuid not null
    references public.project_labour_task_progress(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  reason text not null
    check (
      reason in (
        'budget_unrealistic',
        'extra_prep',
        'moving_furniture',
        'waiting',
        'other'
      )
    ),
  note text check (char_length(note) <= 280),
  hours_over numeric not null default 0 check (hours_over >= 0),
  budget_revision integer,
  created_at timestamptz not null default timezone('utc', now()),
  unique (client_id)
);

comment on table public.project_labour_task_over_budget_reasons is
  'Append-only painter explanations for task budget overruns. task_id stores the permanent project_labour_task_progress identity.';

comment on column public.project_labour_task_over_budget_reasons.client_id is
  'Device-generated idempotency key used by the offline write queue.';

comment on column public.project_labour_task_over_budget_reasons.task_id is
  'Permanent project_labour_task_progress ID. Inserts may supply a versioned project_labour_tasks ID, which is resolved by a trigger.';

create index project_labour_task_over_budget_reasons_task_revision_idx
  on public.project_labour_task_over_budget_reasons(
    task_id,
    budget_revision,
    created_at desc
  );

create index project_labour_task_over_budget_reasons_user_created_idx
  on public.project_labour_task_over_budget_reasons(user_id, created_at desc);

create or replace function public.resolve_project_labour_task_over_budget_reason_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stable_task_id uuid;
begin
  select task.progress_id
  into stable_task_id
  from public.project_labour_tasks task
  where task.id = new.task_id;

  if stable_task_id is null then
    select progress.id
    into stable_task_id
    from public.project_labour_task_progress progress
    where progress.id = new.task_id;
  end if;

  if stable_task_id is null then
    raise exception 'Painter task not found' using errcode = 'P0002';
  end if;

  new.task_id := stable_task_id;
  return new;
end;
$$;

comment on function public.resolve_project_labour_task_over_budget_reason_task() is
  'Resolves a versioned mobile task ID to its permanent job-item identity before an over-budget reason is stored.';

revoke all
  on function public.resolve_project_labour_task_over_budget_reason_task()
  from public, anon, authenticated;

create trigger resolve_project_labour_task_over_budget_reason_task
before insert on public.project_labour_task_over_budget_reasons
for each row
execute function public.resolve_project_labour_task_over_budget_reason_task();

create or replace function public.can_submit_project_labour_task_over_budget_reason(
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
    from public.project_labour_task_progress progress
    where progress.id = requested_task_id
      and public.can_access_project_labour_job(progress.companycam_project_id)
  )
$$;

comment on function public.can_submit_project_labour_task_over_budget_reason(uuid) is
  'True when the signed-in employee may access the job owning the permanent task identity.';

revoke all
  on function public.can_submit_project_labour_task_over_budget_reason(uuid)
  from public, anon;
grant execute
  on function public.can_submit_project_labour_task_over_budget_reason(uuid)
  to authenticated;

alter table public.project_labour_task_over_budget_reasons enable row level security;

create policy "Painters can read own over-budget reasons and managers can read all"
on public.project_labour_task_over_budget_reasons
for select
to authenticated
using (
  user_id = auth.uid()
  or public.current_employee_role() in ('admin', 'manager')
);

create policy "Painters can submit own assigned over-budget reasons"
on public.project_labour_task_over_budget_reasons
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.can_submit_project_labour_task_over_budget_reason(task_id)
);

revoke all
  on table public.project_labour_task_over_budget_reasons
  from anon, authenticated;
grant select, insert
  on table public.project_labour_task_over_budget_reasons
  to authenticated;
