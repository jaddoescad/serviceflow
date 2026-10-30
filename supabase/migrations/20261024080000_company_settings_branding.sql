-- Settings › Branding and Company documents need the settings company's id
-- (uploads go under <org_id>/ in document-assets), its saved logo and colour,
-- and whether the person manages it. Same output as before plus those fields.
begin;

create or replace function public.get_company_settings()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  company uuid := private.web_org_id();
  manager boolean;
  result jsonb;
begin
  if not private.is_org_member(company) then
    raise exception 'You do not have access to this company.' using errcode = '42501';
  end if;
  manager := private.is_org_manager(company);

  select jsonb_build_object(
    'company', jsonb_build_object(
      'id', o.id,
      'name', o.name, 'trade', o.trade, 'phone', o.phone, 'address', o.address,
      'timezone', o.timezone, 'created_at', o.created_at,
      'logo_path', o.settings ->> 'logo_path', 'brand_color', o.settings ->> 'brand_color'),
    'my_role', private.org_role(company),
    'can_edit', coalesce(private.org_role(company) in ('owner', 'admin'), false),
    'is_manager', manager,
    'team', (
      select jsonb_build_object(
        'active', count(*) filter (where m.is_active),
        'inactive', count(*) filter (where not m.is_active),
        'owners', count(*) filter (where m.is_active and m.role = 'owner'),
        'admins', count(*) filter (where m.is_active and m.role = 'admin'),
        'managers', count(*) filter (where m.is_active and m.role = 'manager'),
        'crew', count(*) filter (where m.is_active and m.role = 'crew'))
      from public.org_members m where m.org_id = company),
    'integrations', case when manager then jsonb_build_object(
      'dripjobs', (
        select jsonb_build_object(
          'events', count(*),
          'events_30d', count(*) filter (where e.received_at > now() - interval '30 days'),
          'failed_30d', count(*) filter (where e.processing_status = 'failed' and e.received_at > now() - interval '30 days'),
          'last_received_at', max(e.received_at))
        from private.integration_events e
        where e.org_id = company and e.provider = 'dripjobs'),
      'companycam', (
        select jsonb_build_object('photos', count(*), 'last_imported_at', max(m.created_at))
        from public.job_media m
        where m.org_id = company and m.source_provider = 'companycam'),
      'app_photos', (
        select jsonb_build_object('photos', count(*), 'last_uploaded_at', max(m.created_at))
        from public.job_media m
        where m.org_id = company and m.source_provider = 'app'))
    end)
  into result
  from public.organizations o
  where o.id = company;

  return result;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
