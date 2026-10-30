-- Deliver queued drips and customer messages every minute. The bearer token
-- lives in Vault as messages_cron_secret and in the function's
-- MESSAGES_CRON_SECRET; neither is stored in this repository.
select cron.schedule(
  'send-outbound-messages',
  '* * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
      limit 1
    ) || '/functions/v1/send-messages',
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
