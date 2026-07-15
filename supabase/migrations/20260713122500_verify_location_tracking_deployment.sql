-- Fail the deployment if any security, scheduling, or secret prerequisite for
-- location tracking is missing. This migration is assertion-only and does not
-- create runtime objects.
do $verification$
declare
  tracking_policy_count integer;
begin
  if exists (
    select 1
    from pg_class
    where oid in (
      'public.employee_location_points'::regclass,
      'public.employee_tracking_status'::regclass,
      'public.location_tracking_alerts'::regclass
    )
      and not relrowsecurity
  ) then
    raise exception 'RLS is not enabled on every location tracking table';
  end if;

  select count(*)
  into tracking_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'employee_location_points',
      'employee_tracking_status',
      'location_tracking_alerts'
    )
    and policyname in (
      'Users and managers can read location points',
      'Users can create own location points',
      'Users and managers can read tracking status',
      'Users can create own tracking status',
      'Users can update own tracking status',
      'Managers can read location tracking alerts'
    );

  if tracking_policy_count <> 6 then
    raise exception 'Expected 6 location tracking RLS policies, found %', tracking_policy_count;
  end if;

  if to_regprocedure('public.purge_expired_employee_location_points(integer)') is null then
    raise exception 'Location retention function is missing';
  end if;

  if not exists (
    select 1
    from cron.job
    where jobname = 'purge-employee-location-points'
      and schedule = '30 3 * * *'
  ) then
    raise exception 'Location retention cron job is missing or misconfigured';
  end if;

  if not exists (
    select 1
    from cron.job
    where jobname = 'stale-location-alerts'
      and schedule = '*/5 * * * *'
  ) then
    raise exception 'Stale location alert cron job is missing or misconfigured';
  end if;

  if not exists (select 1 from vault.secrets where name = 'project_url') then
    raise exception 'Vault project_url is missing';
  end if;

  if not exists (
    select 1
    from vault.secrets
    where name = 'location_tracking_alert_cron_secret'
  ) then
    raise exception 'Vault location tracking alert cron secret is missing';
  end if;

  if to_regprocedure('public.configure_location_tracking_alert_cron_secret(text)') is not null then
    raise exception 'Temporary location tracking secret configuration function still exists';
  end if;
end;
$verification$;
