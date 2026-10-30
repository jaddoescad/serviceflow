-- Push queued appointment and job changes to connected Google Calendars every
-- minute. Uses the same Vault bearer secret as send-messages.
select cron.schedule(
  'calendar-sync',
  '* * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
      limit 1
    ) || '/functions/v1/calendar-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'messages_cron_secret'
        limit 1
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
