create table if not exists public.location_tracking_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,
  stale_since timestamptz not null,
  last_notified_at timestamptz,
  resolved_at timestamptz,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (time_entry_id)
);

create index if not exists location_tracking_alerts_unresolved_idx
  on public.location_tracking_alerts (resolved_at, last_notified_at)
  where resolved_at is null;

drop trigger if exists set_location_tracking_alerts_updated_at on public.location_tracking_alerts;
create trigger set_location_tracking_alerts_updated_at
before update on public.location_tracking_alerts
for each row execute function public.set_updated_at();

alter table public.location_tracking_alerts enable row level security;

drop policy if exists "Managers can read location tracking alerts" on public.location_tracking_alerts;
create policy "Managers can read location tracking alerts"
on public.location_tracking_alerts
for select
to authenticated
using (public.current_employee_role() in ('admin', 'manager'));

-- Writes are intentionally server-only. The scheduled Edge Function uses the
-- service role and painter devices cannot suppress or resolve alerts.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select cron.unschedule('stale-location-alerts')
where exists (
  select 1 from cron.job where jobname = 'stale-location-alerts'
);

select cron.schedule(
  'stale-location-alerts',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
      limit 1
    ) || '/functions/v1/stale-location-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'location_tracking_alert_cron_secret'
        limit 1
      ), '')
    ),
    body := jsonb_build_object('scheduled_at', now())
  ) as request_id;
  $$
);
