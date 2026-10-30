-- Settings, company profile, labour settings, invites and new customers
-- failed for people in more than one company ("Choose which company this is
-- for."). The web admin has no company switcher, so these use the company an
-- action names, else the one the person joined first, like the rest of the
-- web admin.
begin;

create function private.web_org_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('serviceflow.org_id', true), '')::uuid,
    private.home_org_id(),
    private.acting_org_id())
$$;
revoke all on function private.web_org_id() from public, anon;
grant execute on function private.web_org_id() to authenticated;

do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.get_company_settings()'::regprocedure,
    'public.get_labour_budget_settings()'::regprocedure,
    'public.save_company_profile(text, text, text, text)'::regprocedure,
    'public.save_labour_budget_settings(integer, numeric, numeric)'::regprocedure,
    'public.invite_to_company(text, text, uuid)'::regprocedure,
    'public.create_customer_contact(uuid, text, text, text, text)'::regprocedure
  ] loop
    execute replace(pg_get_functiondef(fn), 'private.acting_org_id()', 'private.web_org_id()');
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
