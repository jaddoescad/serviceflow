create extension if not exists pgcrypto;

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  user_email text,
  user_name text,
  companycam_project_id text references public.companycam_projects(companycam_id) on delete set null,
  project_name text not null,
  project_address text,
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null default 'active' check (status in ('active', 'complete')),
  clock_in_latitude double precision,
  clock_in_longitude double precision,
  clock_out_latitude double precision,
  clock_out_longitude double precision,
  last_distance_meters integer,
  is_on_site boolean,
  segments jsonb not null default '[]'::jsonb,
  notes text,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists time_entries_user_started_idx
  on public.time_entries (user_id, started_at desc);

create index if not exists time_entries_project_started_idx
  on public.time_entries (companycam_project_id, started_at desc);

create index if not exists time_entries_status_idx
  on public.time_entries (status);

alter table public.time_entries enable row level security;

drop policy if exists "Authenticated users can read time entries" on public.time_entries;
create policy "Authenticated users can read time entries"
  on public.time_entries
  for select
  to authenticated
  using (true);

drop policy if exists "Users can insert own time entries" on public.time_entries;
create policy "Users can insert own time entries"
  on public.time_entries
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own time entries" on public.time_entries;
create policy "Users can update own time entries"
  on public.time_entries
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own time entries" on public.time_entries;
create policy "Users can delete own time entries"
  on public.time_entries
  for delete
  to authenticated
  using (auth.uid() = user_id);
