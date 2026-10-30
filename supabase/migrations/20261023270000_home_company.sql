-- The company the web admin acts in, for page copy and the request form link.
create function public.get_home_company()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug)
  from public.organizations o
  where o.id = private.home_org_id()
$$;
revoke all on function public.get_home_company() from public, anon;
grant execute on function public.get_home_company() to authenticated;

select pg_notify('pgrst', 'reload schema');
