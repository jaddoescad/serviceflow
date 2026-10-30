-- Richer customer documents: photos and files attached to a proposal, change
-- order or invoice; company documents (insurance, WSIB) offered with every
-- proposal; and company branding (logo, accent colour) on customer pages.
-- Customers have no login, so attachments are copies stored in the public
-- `document-assets` bucket under unguessable names, the way the private
-- document link itself is the credential.
begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('document-assets', 'document-assets', true, 26214400)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

-- Objects live under <org_id>/...; managers of that company upload and delete.
create policy "Company managers upload document assets" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'document-assets'
    and private.try_uuid((storage.foldername(name))[1]) in (select private.my_managed_org_ids())
  );
create policy "Company managers delete document assets" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'document-assets'
    and private.try_uuid((storage.foldername(name))[1]) in (select private.my_managed_org_ids())
  );

create table public.document_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  document_kind text not null check (document_kind in ('proposal', 'change_order', 'invoice')),
  document_id uuid not null,
  kind text not null check (kind in ('photo', 'file')),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  storage_path text not null unique,
  mime_type text,
  byte_size bigint not null default 0 check (byte_size >= 0),
  position integer not null default 0,
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index document_assets_document_idx on public.document_assets (document_id, position);

create table public.company_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  storage_path text not null unique,
  mime_type text,
  byte_size bigint not null default 0 check (byte_size >= 0),
  created_at timestamptz not null default now()
);
create index company_documents_org_idx on public.company_documents (org_id, name);

alter table public.quotes add column include_company_documents boolean not null default true;

-- The document fixes the company; files must sit in that company's folder.
create function private.document_asset_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.org_id := case new.document_kind
    when 'proposal' then (select org_id from public.quotes where id = new.document_id)
    when 'change_order' then (select org_id from public.change_orders where id = new.document_id)
    else (select org_id from public.invoices where id = new.document_id) end;
  if new.org_id is null then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;
  if split_part(new.storage_path, '/', 1) <> new.org_id::text then
    raise exception 'File is stored under another company.' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function private.document_asset_guard() from public, anon, authenticated;
create trigger document_asset_guard before insert on public.document_assets
  for each row execute function private.document_asset_guard();

create function private.company_document_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.org_id := coalesce(new.org_id, private.web_org_id());
  if split_part(new.storage_path, '/', 1) <> new.org_id::text then
    raise exception 'File is stored under another company.' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function private.company_document_guard() from public, anon, authenticated;
create trigger company_document_guard before insert on public.company_documents
  for each row execute function private.company_document_guard();

alter table public.document_assets enable row level security;
alter table public.company_documents enable row level security;
revoke all on public.document_assets, public.company_documents from anon, authenticated;
grant select, insert, update, delete on public.document_assets, public.company_documents to authenticated;
create policy org_member_read on public.document_assets for select to authenticated
  using (org_id in (select private.my_org_ids()));
create policy org_manager_insert on public.document_assets for insert to authenticated
  with check (org_id in (select private.my_managed_org_ids()));
create policy org_manager_update on public.document_assets for update to authenticated
  using (org_id in (select private.my_managed_org_ids()))
  with check (org_id in (select private.my_managed_org_ids()));
create policy org_manager_delete on public.document_assets for delete to authenticated
  using (org_id in (select private.my_managed_org_ids()));
create policy org_member_read on public.company_documents for select to authenticated
  using (org_id in (select private.my_org_ids()));
create policy org_manager_insert on public.company_documents for insert to authenticated
  with check (org_id in (select private.my_managed_org_ids()));
create policy org_manager_delete on public.company_documents for delete to authenticated
  using (org_id in (select private.my_managed_org_ids()));

-- Branding: a logo stored in document-assets and an accent colour.
create function public.save_company_branding(requested_logo_path text, requested_brand_color text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.web_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can change branding.' using errcode = '42501';
  end if;
  if requested_logo_path is not null and requested_logo_path <> ''
    and split_part(requested_logo_path, '/', 1) <> company::text then
    raise exception 'Logo is stored under another company.' using errcode = '42501';
  end if;
  if requested_brand_color is not null and requested_brand_color <> ''
    and requested_brand_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Choose a colour like #2f6bff.' using errcode = '22023';
  end if;
  update public.organizations set settings = settings
    || jsonb_build_object('logo_path', nullif(requested_logo_path, ''), 'brand_color', nullif(requested_brand_color, '')),
    updated_at = now()
  where id = company;
end
$$;
revoke all on function public.save_company_branding(text, text) from public, anon;
grant execute on function public.save_company_branding(text, text) to authenticated;

create or replace function public.get_home_company()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug,
    'logoPath', o.settings ->> 'logo_path', 'brandColor', o.settings ->> 'brand_color')
  from public.organizations o
  where o.id = private.home_org_id()
$$;

-- What every customer page shows about the company and the document's files.
create function private.public_company(company uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', o.name, 'phone', o.phone, 'address', o.address,
    'logoPath', o.settings ->> 'logo_path', 'brandColor', o.settings ->> 'brand_color')
  from public.organizations o where o.id = company
$$;
revoke all on function private.public_company(uuid) from public, anon, authenticated;

create function private.public_assets(requested_document uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'name', a.name,
      'path', a.storage_path, 'mimeType', a.mime_type, 'byteSize', a.byte_size) order by a.position, a.created_at), '[]'::jsonb)
  from public.document_assets a where a.document_id = requested_document
$$;
revoke all on function private.public_assets(uuid) from public, anon, authenticated;

create or replace function public.view_public_proposal(requested_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  found_quote public.quotes%rowtype;
  sums record;
  deposit bigint;
begin
  if requested_token is null or char_length(requested_token) < 24 then
    return null;
  end if;
  select * into found_quote from public.quotes where public_token = requested_token;
  if not found then
    return null;
  end if;
  if found_quote.status = 'sent' and found_quote.viewed_at is null then
    update public.quotes set viewed_at = now() where id = found_quote.id;
  end if;
  select * into sums from private.line_item_totals(found_quote.line_items, found_quote.tax_rate_percent);
  deposit := coalesce(found_quote.deposit_cents,
    round(sums.total_cents * coalesce(found_quote.deposit_percent, 0) / 100)::bigint);
  return (
    select jsonb_build_object(
      'kind', 'proposal',
      'name', found_quote.name, 'status', found_quote.status,
      'items', found_quote.line_items, 'taxRatePercent', found_quote.tax_rate_percent,
      'subtotalCents', sums.subtotal_cents, 'taxCents', sums.tax_cents, 'totalCents', sums.total_cents,
      'depositPercent', found_quote.deposit_percent, 'depositCents', deposit,
      'intro', found_quote.intro, 'terms', found_quote.terms,
      'sentAt', found_quote.sent_at, 'signedName', found_quote.signed_name,
      'signedAt', found_quote.signed_at, 'declinedAt', found_quote.declined_at,
      'customer', jsonb_build_object('name', c.name, 'email', c.email, 'phone', c.phone,
        'address', l.address),
      'company', private.public_company(found_quote.org_id),
      'assets', private.public_assets(found_quote.id),
      'companyDocuments', case when found_quote.include_company_documents then coalesce((
        select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'path', d.storage_path,
          'mimeType', d.mime_type, 'byteSize', d.byte_size) order by d.name)
        from public.company_documents d where d.org_id = found_quote.org_id), '[]'::jsonb)
        else '[]'::jsonb end)
    from public.leads l
    join public.contacts c on c.id = l.contact_id
    where l.id = found_quote.lead_id);
end
$$;

create or replace function public.view_public_change_order(requested_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  found_order public.change_orders%rowtype;
  sums record;
begin
  if requested_token is null or char_length(requested_token) < 24 then
    return null;
  end if;
  select * into found_order from public.change_orders where public_token = requested_token;
  if not found then
    return null;
  end if;
  if found_order.status = 'sent' and found_order.viewed_at is null then
    update public.change_orders set viewed_at = now() where id = found_order.id;
  end if;
  select * into sums from private.line_item_totals(found_order.line_items, found_order.tax_rate_percent);
  return (
    select jsonb_build_object(
      'kind', 'change_order', 'number', found_order.number::text,
      'name', found_order.name, 'status', found_order.status,
      'items', found_order.line_items, 'taxRatePercent', found_order.tax_rate_percent,
      'subtotalCents', sums.subtotal_cents, 'taxCents', sums.tax_cents, 'totalCents', sums.total_cents,
      'intro', found_order.intro, 'terms', null, 'sentAt', found_order.sent_at,
      'signedName', found_order.signed_name, 'signedAt', found_order.signed_at,
      'declinedAt', found_order.declined_at,
      'customer', jsonb_build_object('name', c.name, 'email', c.email, 'phone', c.phone,
        'address', coalesce(j.formatted_address, j.address_line_1)),
      'company', private.public_company(found_order.org_id),
      'assets', private.public_assets(found_order.id),
      'companyDocuments', '[]'::jsonb)
    from public.jobs j
    join public.contacts c on c.id = j.contact_id
    where j.id = found_order.job_id);
end
$$;

create or replace function public.view_public_invoice(requested_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  found_invoice public.invoices%rowtype;
  sums record;
  paid bigint;
begin
  if requested_token is null or char_length(requested_token) < 24 then
    return null;
  end if;
  select * into found_invoice from public.invoices
  where public_token = requested_token and status <> 'draft';
  if not found then
    return null;
  end if;
  if found_invoice.viewed_at is null then
    update public.invoices set viewed_at = now() where id = found_invoice.id;
  end if;
  select * into sums from private.line_item_totals(found_invoice.line_items, found_invoice.tax_rate_percent);
  paid := (select coalesce(sum(amount_cents), 0) from public.invoice_payments where invoice_id = found_invoice.id);
  return (
    select jsonb_build_object(
      'kind', 'invoice', 'number', found_invoice.number::text,
      'name', found_invoice.name,
      'status', private.invoice_state(found_invoice.status, found_invoice.amount_cents, paid, found_invoice.due_on),
      'items', found_invoice.line_items, 'taxRatePercent', found_invoice.tax_rate_percent,
      'subtotalCents', sums.subtotal_cents, 'taxCents', sums.tax_cents, 'totalCents', sums.total_cents,
      'paidCents', paid, 'balanceCents', found_invoice.amount_cents - paid,
      'dueOn', found_invoice.due_on, 'intro', found_invoice.notes, 'terms', null,
      'sentAt', coalesce(found_invoice.sent_at, found_invoice.issued_on::timestamptz),
      'customer', jsonb_build_object('name', c.name, 'email', c.email, 'phone', c.phone,
        'address', coalesce(j.formatted_address, j.address_line_1)),
      'company', private.public_company(found_invoice.org_id),
      'assets', private.public_assets(found_invoice.id),
      'companyDocuments', '[]'::jsonb)
    from public.jobs j
    join public.contacts c on c.id = j.contact_id
    where j.id = found_invoice.job_id);
end
$$;

-- Proposals keep the "include company documents" choice with the rest of the body.
create function public.set_proposal_company_documents(requested_id uuid, requested_include boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_org_manager((select org_id from public.quotes where id = requested_id)) then
    raise exception 'Only managers can edit proposals.' using errcode = '42501';
  end if;
  update public.quotes set include_company_documents = coalesce(requested_include, true), updated_at = now()
  where id = requested_id;
end
$$;
revoke all on function public.set_proposal_company_documents(uuid, boolean) from public, anon;
grant execute on function public.set_proposal_company_documents(uuid, boolean) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
