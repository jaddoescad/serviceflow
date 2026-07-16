-- Store fixed-price painter and subcontractor invoices separately from
-- timesheets. These costs must not be represented as invented hours or an
-- artificial hourly pay rate.

create table if not exists public.project_labour_expenses (
  id uuid primary key default gen_random_uuid(),
  companycam_project_id text not null
    references public.companycam_projects(companycam_id) on update cascade on delete restrict,
  worker_user_id uuid
    references public.employee_profiles(user_id) on delete set null,
  worker_name text not null check (length(trim(worker_name)) > 0),
  supplier_name text not null check (length(trim(supplier_name)) > 0),
  invoice_number text not null check (length(trim(invoice_number)) > 0),
  invoice_date date not null,
  amount_before_tax numeric(12, 2) not null check (amount_before_tax >= 0),
  tax_amount numeric(12, 2) not null default 0 check (tax_amount >= 0),
  notes text,
  inserted_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint project_labour_expenses_invoice_key
    unique (companycam_project_id, supplier_name, invoice_number)
);

create index if not exists project_labour_expenses_project_idx
  on public.project_labour_expenses(companycam_project_id, invoice_date desc);

create index if not exists project_labour_expenses_worker_idx
  on public.project_labour_expenses(worker_user_id, invoice_date desc)
  where worker_user_id is not null;

drop trigger if exists set_project_labour_expenses_updated_at on public.project_labour_expenses;
create trigger set_project_labour_expenses_updated_at
before update on public.project_labour_expenses
for each row execute function public.set_updated_at();

alter table public.project_labour_expenses enable row level security;

drop policy if exists "Managers can read project labour expenses" on public.project_labour_expenses;
create policy "Managers can read project labour expenses"
on public.project_labour_expenses
for select
to authenticated
using (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can insert project labour expenses" on public.project_labour_expenses;
create policy "Managers can insert project labour expenses"
on public.project_labour_expenses
for insert
to authenticated
with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can update project labour expenses" on public.project_labour_expenses;
create policy "Managers can update project labour expenses"
on public.project_labour_expenses
for update
to authenticated
using (public.current_employee_role() in ('admin', 'manager'))
with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Admins can delete project labour expenses" on public.project_labour_expenses;
create policy "Admins can delete project labour expenses"
on public.project_labour_expenses
for delete
to authenticated
using (public.current_employee_role() = 'admin');

comment on table public.project_labour_expenses is
  'Fixed-price painter and subcontractor labour invoices. Labour metrics use amount_before_tax; time entries remain the source of hours.';

comment on column public.project_labour_expenses.tax_amount is
  'Invoice tax recorded for audit only. It is excluded from painter labour metrics.';
