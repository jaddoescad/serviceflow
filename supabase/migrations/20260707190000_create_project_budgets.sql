-- Hourly (and optional dollar) budget per CompanyCam job, set from the admin
-- dashboard. Kept in its own table so the CompanyCam sync (which upserts
-- companycam_projects) never touches operational budgeting data, and so the
-- budget policies stay scoped to admins/managers only.

create table if not exists public.project_budgets (
  companycam_project_id text primary key
    references public.companycam_projects(companycam_id) on delete cascade,
  budgeted_hours numeric(10, 2) check (budgeted_hours is null or budgeted_hours >= 0),
  hourly_rate numeric(10, 2) check (hourly_rate is null or hourly_rate >= 0),
  notes text,
  updated_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_project_budgets_updated_at on public.project_budgets;
create trigger set_project_budgets_updated_at
before update on public.project_budgets
for each row execute function public.set_updated_at();

alter table public.project_budgets enable row level security;

-- Only active admins/managers may read or write budgets. current_employee_role()
-- (migration 20260630150000) returns the caller's active role, or null.
drop policy if exists "Managers can read project budgets" on public.project_budgets;
create policy "Managers can read project budgets"
on public.project_budgets
for select
to authenticated
using (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can insert project budgets" on public.project_budgets;
create policy "Managers can insert project budgets"
on public.project_budgets
for insert
to authenticated
with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can update project budgets" on public.project_budgets;
create policy "Managers can update project budgets"
on public.project_budgets
for update
to authenticated
using (public.current_employee_role() in ('admin', 'manager'))
with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Admins can delete project budgets" on public.project_budgets;
create policy "Admins can delete project budgets"
on public.project_budgets
for delete
to authenticated
using (public.current_employee_role() = 'admin');
