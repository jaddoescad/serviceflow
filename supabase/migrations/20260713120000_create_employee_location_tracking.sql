create extension if not exists pgcrypto;

create table if not exists public.employee_location_points (
  id uuid primary key default gen_random_uuid(),
  client_event_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  time_entry_id uuid references public.time_entries(id) on delete cascade,
  client_entry_id text not null,
  companycam_project_id text references public.companycam_projects(companycam_id) on delete set null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision check (accuracy_meters is null or accuracy_meters >= 0),
  speed_mps double precision,
  heading_degrees double precision,
  is_mocked boolean,
  tracking_mode text not null default 'unknown'
    check (tracking_mode in ('painting', 'stationary', 'travel', 'unknown')),
  event_type text not null default 'location'
    check (event_type in ('location', 'clock_in', 'clock_out', 'arrival', 'departure', 'project_switch')),
  distance_from_project_meters integer,
  is_on_site boolean,
  captured_at timestamptz not null,
  received_at timestamptz not null default timezone('utc', now()),
  inserted_at timestamptz not null default timezone('utc', now()),
  unique (user_id, client_event_id)
);

create index if not exists employee_location_points_user_captured_idx
  on public.employee_location_points (user_id, captured_at desc);

create index if not exists employee_location_points_entry_captured_idx
  on public.employee_location_points (time_entry_id, captured_at)
  where time_entry_id is not null;

create index if not exists employee_location_points_client_entry_captured_idx
  on public.employee_location_points (client_entry_id, captured_at);

create index if not exists employee_location_points_captured_brin_idx
  on public.employee_location_points using brin (captured_at);

create table if not exists public.employee_tracking_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  user_email text,
  user_name text,
  time_entry_id uuid references public.time_entries(id) on delete set null,
  client_entry_id text,
  companycam_project_id text references public.companycam_projects(companycam_id) on delete set null,
  project_name text,
  project_address text,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  accuracy_meters double precision check (accuracy_meters is null or accuracy_meters >= 0),
  last_location_at timestamptz,
  last_sync_at timestamptz,
  tracking_mode text not null default 'clocked_out'
    check (tracking_mode in ('clocked_out', 'painting', 'stationary', 'travel', 'unavailable', 'unknown')),
  task_status text not null default 'stopped'
    check (task_status in ('running', 'geofence', 'paused', 'stopped', 'error')),
  permission_foreground boolean,
  permission_background boolean,
  platform text check (platform is null or platform in ('ios', 'android', 'web')),
  app_version text,
  last_error_code text,
  metadata jsonb not null default '{}'::jsonb,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists employee_tracking_status_mode_location_idx
  on public.employee_tracking_status (tracking_mode, last_location_at desc);

drop trigger if exists set_employee_tracking_status_updated_at on public.employee_tracking_status;
create trigger set_employee_tracking_status_updated_at
before update on public.employee_tracking_status
for each row execute function public.set_updated_at();

alter table public.employee_location_points enable row level security;
alter table public.employee_tracking_status enable row level security;

drop policy if exists "Users and managers can read location points" on public.employee_location_points;
create policy "Users and managers can read location points"
on public.employee_location_points
for select
to authenticated
using (
  user_id = auth.uid()
  or public.current_employee_role() in ('admin', 'manager')
);

drop policy if exists "Users can create own location points" on public.employee_location_points;
create policy "Users can create own location points"
on public.employee_location_points
for insert
to authenticated
with check (user_id = auth.uid());

-- Location points are append-only from the client. Corrections and retention
-- run through trusted server/migration paths, not painter devices.

drop policy if exists "Users and managers can read tracking status" on public.employee_tracking_status;
create policy "Users and managers can read tracking status"
on public.employee_tracking_status
for select
to authenticated
using (
  user_id = auth.uid()
  or public.current_employee_role() in ('admin', 'manager')
);

drop policy if exists "Users can create own tracking status" on public.employee_tracking_status;
create policy "Users can create own tracking status"
on public.employee_tracking_status
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update own tracking status" on public.employee_tracking_status;
create policy "Users can update own tracking status"
on public.employee_tracking_status
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.purge_expired_employee_location_points(retention_days integer default 60)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  if retention_days < 7 or retention_days > 365 then
    raise exception 'retention_days must be between 7 and 365';
  end if;

  delete from public.employee_location_points
  where captured_at < timezone('utc', now()) - make_interval(days => retention_days);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_employee_location_points(integer) from public;

create extension if not exists pg_cron with schema extensions;

select cron.unschedule('purge-employee-location-points')
where exists (
  select 1 from cron.job where jobname = 'purge-employee-location-points'
);

select cron.schedule(
  'purge-employee-location-points',
  '30 3 * * *',
  $$select public.purge_expired_employee_location_points(60);$$
);
