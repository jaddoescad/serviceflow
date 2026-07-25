-- Expose when a task was checked off so the mobile checklist can show it.
drop function if exists public.list_project_labour_tasks_live(text);

create function public.list_project_labour_tasks_live(requested_project_id text)
returns table(
  labour_budget_id uuid,
  companycam_project_id text,
  source_quote_id text,
  source_quote_name text,
  instructions text,
  total_budgeted_hours numeric,
  budget_revision integer,
  published_at timestamp with time zone,
  task_id uuid,
  source_kind text,
  title text,
  notes text,
  task_budgeted_hours numeric,
  hours_spent numeric,
  status text,
  sort_order integer,
  metadata jsonb,
  my_active_started_at timestamp with time zone,
  active_painters jsonb,
  completed_at timestamp with time zone
)
language plpgsql
stable security definer
set search_path to ''
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
    coalesce(live_state.active_painters, '[]'::jsonb),
    progress.completed_at
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

revoke all on function public.list_project_labour_tasks_live(text) from public, anon;
grant execute on function public.list_project_labour_tasks_live(text) to authenticated;;
