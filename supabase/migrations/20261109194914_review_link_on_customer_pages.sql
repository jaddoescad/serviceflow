-- Customer pages link to the company's review page from their sidebar. The
-- link is the one already set under Settings > Reviews & aftercare.
create or replace function private.public_company(company uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', o.name, 'phone', o.phone, 'address', o.address,
    'logoPath', o.settings ->> 'logo_path', 'brandColor', o.settings ->> 'brand_color',
    'page', coalesce(o.settings -> 'proposal_page', '{}'::jsonb),
    'reviewLink', nullif(o.settings #>> '{reviews,link}', ''))
  from public.organizations o where o.id = company
$$;
