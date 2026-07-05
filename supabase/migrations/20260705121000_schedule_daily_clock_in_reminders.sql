create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Supabase cron runs in UTC. This is 7:00 AM America/Toronto during daylight
-- saving time. Change to '0 12 * * *' for 7:00 AM standard time, or manage the
-- job in the Supabase Cron UI if local-time DST adjustment is required.
select cron.unschedule('daily-clock-in-reminders')
where exists (
  select 1
  from cron.job
  where jobname = 'daily-clock-in-reminders'
);

select cron.schedule(
  'daily-clock-in-reminders',
  '0 11 * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
      limit 1
    ) || '/functions/v1/daily-clock-in-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'clock_in_reminder_cron_secret'
        limit 1
      ), '')
    ),
    body := jsonb_build_object('scheduled_at', now())
  ) as request_id;
  $$
);
