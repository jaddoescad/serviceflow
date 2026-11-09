-- The company's own parts of every customer proposal page (cover image,
-- licence, three highlights, "Why choose us", stats and default terms), set in
-- Settings and kept with the logo and colour in organizations.settings.

create function public.save_proposal_page(requested_page jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.web_org_id();
  hero text := requested_page ->> 'heroPath';
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can change the proposal page.' using errcode = '42501';
  end if;
  if jsonb_typeof(requested_page) is distinct from 'object' or pg_column_size(requested_page) > 100000 then
    raise exception 'These proposal page settings are not valid.' using errcode = '22023';
  end if;
  if hero is not null and hero <> '' and split_part(hero, '/', 1) <> company::text then
    raise exception 'The cover image is stored under another company.' using errcode = '42501';
  end if;
  update public.organizations
  set settings = settings || jsonb_build_object('proposal_page', requested_page), updated_at = now()
  where id = company;
end
$$;
revoke all on function public.save_proposal_page(jsonb) from public, anon;
grant execute on function public.save_proposal_page(jsonb) to authenticated;

-- Customer pages read the company through here.
create or replace function private.public_company(company uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', o.name, 'phone', o.phone, 'address', o.address,
    'logoPath', o.settings ->> 'logo_path', 'brandColor', o.settings ->> 'brand_color',
    'page', coalesce(o.settings -> 'proposal_page', '{}'::jsonb))
  from public.organizations o where o.id = company
$$;

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
      'logo_path', o.settings ->> 'logo_path', 'brand_color', o.settings ->> 'brand_color',
      'proposal_page', coalesce(o.settings -> 'proposal_page', '{}'::jsonb)),
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
