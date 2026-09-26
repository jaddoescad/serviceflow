-- Admin Settings page: the company profile (editable by owners and admins)
-- and one read of everything the page shows about the company.

create function public.get_company_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.acting_org_id();
  manager boolean;
  result jsonb;
begin
  if not private.is_org_member(company) then
    raise exception 'You do not have access to this company.' using errcode = '42501';
  end if;
  manager := private.is_org_manager(company);

  select jsonb_build_object(
    'company', jsonb_build_object(
      'name', o.name, 'trade', o.trade, 'phone', o.phone, 'address', o.address,
      'timezone', o.timezone, 'created_at', o.created_at),
    'my_role', private.org_role(company),
    'can_edit', coalesce(private.org_role(company) in ('owner', 'admin'), false),
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

create function public.save_company_profile(
  requested_name text, requested_trade text, requested_phone text, requested_address text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.acting_org_id();
begin
  perform private.set_acting_org(company);
  if coalesce(private.org_role(company) not in ('owner', 'admin'), true) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if nullif(btrim(requested_name), '') is null or length(btrim(requested_name)) > 120 then
    raise exception 'Enter a company name (up to 120 characters).' using errcode = '22023';
  end if;
  if requested_trade is not null and requested_trade not in (
    'painting', 'plumbing', 'electrical', 'hvac', 'cleaning', 'landscaping',
    'general_contracting', 'other') then
    raise exception 'Choose a trade from the list.' using errcode = '22023';
  end if;
  if length(coalesce(requested_phone, '')) > 40 or length(coalesce(requested_address, '')) > 300 then
    raise exception 'Phone or address is too long.' using errcode = '22023';
  end if;

  update public.organizations
  set name = btrim(requested_name),
      trade = requested_trade,
      phone = nullif(btrim(requested_phone), ''),
      address = nullif(btrim(requested_address), ''),
      updated_at = now()
  where id = company;

  return public.get_company_settings();
end
$$;

revoke all on function public.get_company_settings() from public, anon;
revoke all on function public.save_company_profile(text, text, text, text) from public, anon;
grant execute on function public.get_company_settings() to authenticated;
grant execute on function public.save_company_profile(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
