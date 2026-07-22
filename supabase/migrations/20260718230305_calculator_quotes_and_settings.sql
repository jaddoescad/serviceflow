-- Per-project calculator document (quotes, rooms, rates snapshots) as one JSONB
-- doc — mirrors the client-side ProjectCalculator v2 shape.
create table if not exists public.project_calculators (
  companycam_project_id text primary key,
  doc jsonb not null,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

comment on table public.project_calculators is
  'Painting calculator quotes per CompanyCam project. doc holds the ProjectCalculator v2 JSON (quotes, rooms, rates snapshots).';

alter table public.project_calculators enable row level security;

create policy "Managers can read project calculators"
  on public.project_calculators for select
  using (current_employee_role() = any (array['admin'::text, 'manager'::text]));

create policy "Managers can insert project calculators"
  on public.project_calculators for insert
  with check (current_employee_role() = any (array['admin'::text, 'manager'::text]));

create policy "Managers can update project calculators"
  on public.project_calculators for update
  using (current_employee_role() = any (array['admin'::text, 'manager'::text]))
  with check (current_employee_role() = any (array['admin'::text, 'manager'::text]));

create policy "Admins can delete project calculators"
  on public.project_calculators for delete
  using (current_employee_role() = 'admin'::text);

-- Org-wide calculator settings (company default rates). Single 'default' row.
create table if not exists public.calculator_settings (
  id text primary key default 'default',
  rates jsonb not null,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

comment on table public.calculator_settings is
  'Company-wide calculator defaults. Row id ''default'' holds the rates snapshot new quotes start from.';

alter table public.calculator_settings enable row level security;

create policy "Managers can read calculator settings"
  on public.calculator_settings for select
  using (current_employee_role() = any (array['admin'::text, 'manager'::text]));

create policy "Managers can insert calculator settings"
  on public.calculator_settings for insert
  with check (current_employee_role() = any (array['admin'::text, 'manager'::text]));

create policy "Managers can update calculator settings"
  on public.calculator_settings for update
  using (current_employee_role() = any (array['admin'::text, 'manager'::text]))
  with check (current_employee_role() = any (array['admin'::text, 'manager'::text]));

create policy "Admins can delete calculator settings"
  on public.calculator_settings for delete
  using (current_employee_role() = 'admin'::text);;
