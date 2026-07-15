-- Temporary, service-role-only bootstrap helper. This lets deployment tooling
-- install the cron bearer token in Vault without writing the token into a SQL
-- migration or source control. A follow-up migration drops this function once
-- provisioning succeeds.
create or replace function public.configure_location_tracking_alert_cron_secret(secret_value text)
returns uuid
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  existing_secret_id uuid;
  configured_secret_id uuid;
begin
  if secret_value is null or length(secret_value) < 32 then
    raise exception 'Location tracking alert cron secret must be at least 32 characters';
  end if;

  select id
  into existing_secret_id
  from vault.secrets
  where name = 'location_tracking_alert_cron_secret'
  limit 1;

  if existing_secret_id is null then
    select vault.create_secret(
      secret_value,
      'location_tracking_alert_cron_secret',
      'Bearer token for the stale-location-alerts cron job'
    )
    into configured_secret_id;
  else
    perform vault.update_secret(
      existing_secret_id,
      secret_value,
      'location_tracking_alert_cron_secret',
      'Bearer token for the stale-location-alerts cron job'
    );
    configured_secret_id := existing_secret_id;
  end if;

  return configured_secret_id;
end;
$$;

revoke all on function public.configure_location_tracking_alert_cron_secret(text) from public;
grant execute on function public.configure_location_tracking_alert_cron_secret(text) to service_role;

notify pgrst, 'reload schema';
