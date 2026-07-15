drop function if exists public.configure_location_tracking_alert_cron_secret(text);

notify pgrst, 'reload schema';
