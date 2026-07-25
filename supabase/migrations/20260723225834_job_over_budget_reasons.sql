-- Job-level over-budget reasons. Painters answer once per job at clock-out
-- when the whole job's clocked hours exceed its labour budget (task timers no
-- longer exist, so the old task-level reasons stopped being collected).
create table public.project_over_budget_reasons (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  companycam_project_id text not null,
  user_id uuid not null references auth.users (id),
  reason text not null check (
    reason in ('budget_unrealistic', 'extra_prep', 'moving_furniture', 'waiting', 'other')
  ),
  note text check (note is null or char_length(note) <= 280),
  hours_over numeric not null default 0 check (hours_over >= 0),
  created_at timestamp with time zone not null default timezone('utc', now())
);

create index project_over_budget_reasons_project_idx
  on public.project_over_budget_reasons (companycam_project_id, created_at desc);

alter table public.project_over_budget_reasons enable row level security;

create policy "painters insert own job reasons"
  on public.project_over_budget_reasons
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.can_access_project_labour_job(companycam_project_id)
  );

create policy "own and manager reads"
  on public.project_over_budget_reasons
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.current_employee_role() in ('admin', 'manager')
  );;
