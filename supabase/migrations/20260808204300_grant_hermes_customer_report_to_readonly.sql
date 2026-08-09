-- The Hermes CLI connects through Supabase's dedicated read-only database
-- role. Grant access to this stable, SECURITY INVOKER report only; the role's
-- existing read-only table privileges continue to govern all underlying data.

revoke all on function public.hermes_customer_360(text, integer) from public, anon;

grant execute on function public.hermes_customer_360(text, integer)
to authenticated, service_role, supabase_read_only_user;
