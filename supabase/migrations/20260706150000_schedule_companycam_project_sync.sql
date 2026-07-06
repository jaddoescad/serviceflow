create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select cron.unschedule('sync-companycam-projects-every-15-minutes')
where exists (
  select 1
  from cron.job
  where jobname = 'sync-companycam-projects-every-15-minutes'
);

select cron.schedule(
  'sync-companycam-projects-every-15-minutes',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
      limit 1
    ) || '/functions/v1/sync-companycam-projects',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'companycam_sync_cron_secret'
        limit 1
      ), '')
    ),
    body := jsonb_build_object('scheduled_at', now(), 'source', 'pg_cron')
  ) as request_id;
  $$
);
