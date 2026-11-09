-- Customer documents show their dates in the company's own time zone.
create or replace function private.public_company(company uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', o.name, 'phone', o.phone, 'address', o.address,
    'logoPath', o.settings ->> 'logo_path', 'brandColor', o.settings ->> 'brand_color',
    'page', coalesce(o.settings -> 'proposal_page', '{}'::jsonb),
    'reviewLink', nullif(o.settings #>> '{reviews,link}', ''),
    'timezone', o.timezone)
  from public.organizations o where o.id = company
$$;
