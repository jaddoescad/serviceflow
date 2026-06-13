create extension if not exists pgcrypto;

create table if not exists public.employee_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'painter' check (role in ('admin', 'manager', 'painter')),
  is_active boolean not null default true,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  companycam_project_id text not null references public.companycam_projects(companycam_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'removed')),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (companycam_project_id, user_id)
);

create index if not exists employee_profiles_role_idx on public.employee_profiles(role);
create index if not exists project_assignments_user_status_idx on public.project_assignments(user_id, status);
create index if not exists project_assignments_project_status_idx on public.project_assignments(companycam_project_id, status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_employee_profiles_updated_at on public.employee_profiles;
create trigger set_employee_profiles_updated_at
before update on public.employee_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_project_assignments_updated_at on public.project_assignments;
create trigger set_project_assignments_updated_at
before update on public.project_assignments
for each row execute function public.set_updated_at();

alter table public.employee_profiles enable row level security;
alter table public.project_assignments enable row level security;

drop policy if exists "Authenticated users can read employee profiles" on public.employee_profiles;
create policy "Authenticated users can read employee profiles"
on public.employee_profiles
for select
to authenticated
using (true);

drop policy if exists "Users can create their own employee profile" on public.employee_profiles;
create policy "Users can create their own employee profile"
on public.employee_profiles
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update their own employee profile" on public.employee_profiles;
create policy "Users can update their own employee profile"
on public.employee_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Authenticated users can read project assignments" on public.project_assignments;
create policy "Authenticated users can read project assignments"
on public.project_assignments
for select
to authenticated
using (true);

drop policy if exists "Managers can create project assignments" on public.project_assignments;
create policy "Managers can create project assignments"
on public.project_assignments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.employee_profiles profile
    where profile.user_id = auth.uid()
      and profile.is_active = true
      and profile.role in ('admin', 'manager')
  )
);

drop policy if exists "Managers can update project assignments" on public.project_assignments;
create policy "Managers can update project assignments"
on public.project_assignments
for update
to authenticated
using (
  exists (
    select 1
    from public.employee_profiles profile
    where profile.user_id = auth.uid()
      and profile.is_active = true
      and profile.role in ('admin', 'manager')
  )
)
with check (
  exists (
    select 1
    from public.employee_profiles profile
    where profile.user_id = auth.uid()
      and profile.is_active = true
      and profile.role in ('admin', 'manager')
  )
);

drop policy if exists "Managers can delete project assignments" on public.project_assignments;
create policy "Managers can delete project assignments"
on public.project_assignments
for delete
to authenticated
using (
  exists (
    select 1
    from public.employee_profiles profile
    where profile.user_id = auth.uid()
      and profile.is_active = true
      and profile.role in ('admin', 'manager')
  )
);
