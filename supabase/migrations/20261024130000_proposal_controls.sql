-- Proposal controls: copy a proposal, a valid-until date after which the
-- customer can no longer approve, packages (Good / Better / Best: the customer
-- picks exactly one), a proposal-level discount, and the customer's language
-- on document pages.
begin;

-- Packages are [{id, name, description}]. A line item in a package carries
-- its packageId and is stored like an optional item: only the chosen
-- package's items are selected. Everything that reads line_items (totals,
-- final invoices) keeps counting "required, or optional and selected".
alter table public.quotes
  add column packages jsonb not null default '[]'::jsonb,
  add column selected_package_id text,
  add column discount_percent numeric check (discount_percent >= 0 and discount_percent <= 100),
  add column discount_cents bigint check (discount_cents >= 0),
  add constraint quotes_one_discount_kind check (discount_percent is null or discount_cents is null);

alter table public.proposal_templates
  add column packages jsonb not null default '[]'::jsonb,
  add column selected_package_id text,
  add column discount_percent numeric check (discount_percent >= 0 and discount_percent <= 100),
  add column discount_cents bigint check (discount_cents >= 0),
  add constraint proposal_templates_one_discount_kind check (discount_percent is null or discount_cents is null);

-- A copied proposal points at the same stored photos and files. The stored
-- copy is deleted only when no attachment uses it any more.
alter table public.document_assets drop constraint document_assets_storage_path_key;
create index document_assets_storage_path_idx on public.document_assets (storage_path);

-- Totals with a discount taken before tax. The discount never exceeds the
-- subtotal. Mirrored by documentTotals in web/src/lib/line-items.ts.
create function private.line_item_totals(
  items jsonb, tax_rate numeric, discount_percent numeric, discount_amount bigint,
  out subtotal_cents bigint, out discount_cents bigint, out tax_cents bigint, out total_cents bigint)
language sql immutable set search_path = ''
as $$
  with sums as (
    select coalesce(sum(round((i ->> 'quantity')::numeric * (i ->> 'unitPriceCents')::numeric)), 0) as subtotal
    from jsonb_array_elements(coalesce(items, '[]'::jsonb)) i
    where not (i ->> 'optional')::boolean or (i ->> 'selected')::boolean
  ), discounted as (
    select subtotal, greatest(0, least(subtotal,
      coalesce(discount_amount::numeric, round(subtotal * coalesce(discount_percent, 0) / 100)))) as discount
    from sums
  )
  select subtotal::bigint, discount::bigint,
    round((subtotal - discount) * coalesce(tax_rate, 0) / 100)::bigint,
    (subtotal - discount + round((subtotal - discount) * coalesce(tax_rate, 0) / 100))::bigint
  from discounted
$$;
revoke all on function private.line_item_totals(jsonb, numeric, numeric, bigint) from public, anon, authenticated;

-- Change orders and invoices have no discount; same figures as before.
create or replace function private.line_item_totals(
  items jsonb, tax_rate numeric, out subtotal_cents bigint, out tax_cents bigint, out total_cents bigint)
language sql immutable set search_path = ''
as $$
  select t.subtotal_cents, t.tax_cents, t.total_cents
  from private.line_item_totals(items, tax_rate, null::numeric, null::bigint) t
$$;

create function private.clean_packages(packages jsonb)
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  entry jsonb;
  package_id text;
  result jsonb := '[]'::jsonb;
begin
  if packages is null or jsonb_typeof(packages) = 'null' then
    return result;
  end if;
  if jsonb_typeof(packages) <> 'array' or jsonb_array_length(packages) > 6 then
    raise exception 'A proposal offers up to 6 packages.' using errcode = '22023';
  end if;
  for entry in select value from jsonb_array_elements(packages) loop
    if jsonb_typeof(entry) <> 'object' or nullif(btrim(entry ->> 'name'), '') is null
      or char_length(btrim(entry ->> 'name')) > 80
      or char_length(coalesce(entry ->> 'description', '')) > 1000 then
      raise exception 'Each package needs a name of up to 80 characters.' using errcode = '22023';
    end if;
    package_id := coalesce(nullif(btrim(entry ->> 'id'), ''), gen_random_uuid()::text);
    if char_length(package_id) > 64 or result @> jsonb_build_array(jsonb_build_object('id', package_id)) then
      raise exception 'Each package needs its own id.' using errcode = '22023';
    end if;
    result := result || jsonb_build_array(jsonb_build_object(
      'id', package_id, 'name', btrim(entry ->> 'name'),
      'description', btrim(coalesce(entry ->> 'description', ''))));
  end loop;
  return result;
end
$$;
revoke all on function private.clean_packages(jsonb) from public, anon, authenticated;

-- clean_line_items, then each item that names one of `packages` keeps that
-- packageId and is selected only when it is in the chosen package. Mirrored
-- by syncPackageItems in web/src/lib/line-items.ts.
create function private.clean_proposal_items(items jsonb, packages jsonb, chosen_package text)
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  cleaned jsonb := private.clean_line_items(items);
begin
  return (
    select coalesce(jsonb_agg(
      case when p.id is null then c.item
        else c.item || jsonb_build_object('packageId', p.id, 'optional', true,
          'selected', coalesce(p.id = chosen_package, false)) end
      order by c.position), '[]'::jsonb)
    from jsonb_array_elements(cleaned) with ordinality c(item, position)
    join jsonb_array_elements(coalesce(items, '[]'::jsonb)) with ordinality r(item, position)
      on r.position = c.position
    left join lateral (
      select pk ->> 'id' as id
      from jsonb_array_elements(coalesce(packages, '[]'::jsonb)) pk
      where pk ->> 'id' = r.item ->> 'packageId'
      limit 1) p on true);
end
$$;
revoke all on function private.clean_proposal_items(jsonb, jsonb, text) from public, anon, authenticated;

-- The requested package when it exists, else the first one.
create function private.chosen_package(packages jsonb, requested text)
returns text
language sql immutable set search_path = ''
as $$
  select coalesce(
    (select p ->> 'id' from jsonb_array_elements(coalesce(packages, '[]'::jsonb)) p where p ->> 'id' = requested limit 1),
    coalesce(packages, '[]'::jsonb) -> 0 ->> 'id')
$$;
revoke all on function private.chosen_package(jsonb, text) from public, anon, authenticated;

-- A valid-until date has passed once the company's day is after it.
create function private.proposal_expired(company uuid, valid_until date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(valid_until < (now() at time zone coalesce(
    (select nullif(o.timezone, '') from public.organizations o where o.id = company), 'America/Toronto'))::date, false)
$$;
revoke all on function private.proposal_expired(uuid, date) from public, anon, authenticated;

create function private.check_discount(discount_percent numeric, discount_cents bigint)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if discount_percent is not null and discount_cents is not null then
    raise exception 'Choose a discount percent or amount, not both.' using errcode = '22023';
  end if;
  if discount_percent < 0 or discount_percent > 100 then
    raise exception 'A discount is between 0%% and 100%%.' using errcode = '22023';
  end if;
  if discount_cents < 0 then
    raise exception 'A discount can''t be negative.' using errcode = '22023';
  end if;
end
$$;
revoke all on function private.check_discount(numeric, bigint) from public, anon, authenticated;

drop function public.save_proposal(uuid, uuid, text, jsonb, numeric, numeric, bigint, text, text, uuid);
create function public.save_proposal(
  requested_id uuid, requested_lead uuid, requested_name text, requested_items jsonb,
  requested_tax_rate numeric, requested_deposit_percent numeric, requested_deposit_cents bigint,
  requested_intro text, requested_terms text, requested_template uuid default null,
  requested_packages jsonb default '[]', requested_selected_package text default null,
  requested_discount_percent numeric default null, requested_discount_cents bigint default null,
  requested_valid_until date default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  source_lead public.leads%rowtype;
  existing public.quotes%rowtype;
  package_list jsonb;
  chosen text;
  clean_items jsonb;
  sums record;
begin
  select * into source_lead from public.leads where id = requested_lead for update;
  if not found then
    raise exception 'Deal not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(source_lead.org_id) then
    raise exception 'Only managers can edit proposals.' using errcode = '42501';
  end if;
  perform private.set_acting_org(source_lead.org_id);
  if requested_deposit_percent is not null and requested_deposit_cents is not null then
    raise exception 'Choose a deposit percent or amount, not both.' using errcode = '22023';
  end if;
  perform private.check_discount(requested_discount_percent, requested_discount_cents);
  package_list := private.clean_packages(requested_packages);
  chosen := private.chosen_package(package_list, requested_selected_package);
  clean_items := private.clean_proposal_items(requested_items, package_list, chosen);
  select * into sums from private.line_item_totals(
    clean_items, requested_tax_rate, requested_discount_percent, requested_discount_cents);

  select * into existing from public.quotes where id = requested_id for update;
  if found then
    if existing.lead_id <> requested_lead then
      raise exception 'Proposal belongs to another deal.' using errcode = '42501';
    end if;
    if existing.status in ('accepted', 'superseded') then
      raise exception 'Accepted proposals can''t be edited. Add a change order instead.' using errcode = '22023';
    end if;
    update public.quotes set
      name = coalesce(nullif(btrim(requested_name), ''), name),
      line_items = clean_items, tax_rate_percent = coalesce(requested_tax_rate, 0),
      deposit_percent = requested_deposit_percent, deposit_cents = requested_deposit_cents,
      intro = nullif(btrim(requested_intro), ''), terms = nullif(btrim(requested_terms), ''),
      packages = package_list, selected_package_id = chosen,
      discount_percent = requested_discount_percent, discount_cents = requested_discount_cents,
      valid_until = requested_valid_until,
      amount_cents = sums.total_cents, tax_cents = sums.tax_cents, updated_at = now()
    where id = requested_id;
  else
    insert into public.quotes (
      id, lead_id, name, status, amount_cents, tax_cents, source, line_items, tax_rate_percent,
      deposit_percent, deposit_cents, intro, terms, template_id, packages, selected_package_id,
      discount_percent, discount_cents, valid_until, metadata, created_at, updated_at)
    values (
      requested_id, requested_lead, coalesce(nullif(btrim(requested_name), ''), 'Proposal'), 'draft',
      sums.total_cents, sums.tax_cents, 'proposal', clean_items, coalesce(requested_tax_rate, 0),
      requested_deposit_percent, requested_deposit_cents, nullif(btrim(requested_intro), ''),
      nullif(btrim(requested_terms), ''), requested_template, package_list, chosen,
      requested_discount_percent, requested_discount_cents, requested_valid_until,
      jsonb_build_object('created_by', auth.uid()), now(), now());
    if source_lead.status in ('new', 'contacted', 'estimate_scheduled') then
      update public.leads set status = 'estimated', updated_at = now() where id = source_lead.id;
    end if;
  end if;
  return requested_id;
end
$$;
revoke all on function public.save_proposal(uuid, uuid, text, jsonb, numeric, numeric, bigint, text, text, uuid, jsonb, text, numeric, bigint, date) from public, anon;
grant execute on function public.save_proposal(uuid, uuid, text, jsonb, numeric, numeric, bigint, text, text, uuid, jsonb, text, numeric, bigint, date) to authenticated;

drop function public.save_proposal_template(uuid, text, jsonb, numeric, numeric, bigint, text, text);
create function public.save_proposal_template(
  requested_id uuid, requested_name text, requested_items jsonb, requested_tax_rate numeric,
  requested_deposit_percent numeric, requested_deposit_cents bigint, requested_intro text, requested_terms text,
  requested_packages jsonb default '[]', requested_selected_package text default null,
  requested_discount_percent numeric default null, requested_discount_cents bigint default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := coalesce(
    (select org_id from public.proposal_templates where id = requested_id),
    private.home_org_id());
  package_list jsonb := private.clean_packages(requested_packages);
  chosen text := private.chosen_package(package_list, requested_selected_package);
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can edit templates.' using errcode = '42501';
  end if;
  perform private.check_discount(requested_discount_percent, requested_discount_cents);
  insert into public.proposal_templates as t (
    id, org_id, name, line_items, tax_rate_percent, deposit_percent, deposit_cents, intro, terms,
    packages, selected_package_id, discount_percent, discount_cents)
  values (
    requested_id, company, btrim(requested_name),
    private.clean_proposal_items(requested_items, package_list, chosen),
    coalesce(requested_tax_rate, 0), requested_deposit_percent, requested_deposit_cents,
    nullif(btrim(requested_intro), ''), nullif(btrim(requested_terms), ''),
    package_list, chosen, requested_discount_percent, requested_discount_cents)
  on conflict (id) do update set
    name = excluded.name, line_items = excluded.line_items,
    tax_rate_percent = excluded.tax_rate_percent, deposit_percent = excluded.deposit_percent,
    deposit_cents = excluded.deposit_cents, intro = excluded.intro, terms = excluded.terms,
    packages = excluded.packages, selected_package_id = excluded.selected_package_id,
    discount_percent = excluded.discount_percent, discount_cents = excluded.discount_cents,
    updated_at = now()
  where t.org_id = company;
  return requested_id;
end
$$;
revoke all on function public.save_proposal_template(uuid, text, jsonb, numeric, numeric, bigint, text, text, jsonb, text, numeric, bigint) from public, anon;
grant execute on function public.save_proposal_template(uuid, text, jsonb, numeric, numeric, bigint, text, text, jsonb, text, numeric, bigint) to authenticated;

-- A new draft with the same lines, packages, discount, deposit, message,
-- terms and attachments, for the same deal or another deal of the company.
create function public.duplicate_proposal(requested_id uuid, requested_lead uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  source_quote public.quotes%rowtype;
  target_lead public.leads%rowtype;
  copy_id uuid := gen_random_uuid();
  sums record;
begin
  select * into source_quote from public.quotes where id = requested_id;
  if not found then
    raise exception 'Proposal not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(source_quote.org_id) then
    raise exception 'Only managers can copy proposals.' using errcode = '42501';
  end if;
  if source_quote.source <> 'proposal' then
    raise exception 'Only proposals made here can be copied.' using errcode = '22023';
  end if;
  select * into target_lead from public.leads
  where id = coalesce(requested_lead, source_quote.lead_id) for update;
  if not found or target_lead.org_id <> source_quote.org_id then
    raise exception 'Deal not found.' using errcode = 'P0002';
  end if;
  perform private.set_acting_org(source_quote.org_id);
  select * into sums from private.line_item_totals(source_quote.line_items, source_quote.tax_rate_percent,
    source_quote.discount_percent, source_quote.discount_cents);

  insert into public.quotes (
    id, lead_id, name, status, amount_cents, tax_cents, source, line_items, tax_rate_percent,
    deposit_percent, deposit_cents, intro, terms, template_id, include_company_documents,
    packages, selected_package_id, discount_percent, discount_cents, valid_until,
    metadata, created_at, updated_at)
  values (
    copy_id, target_lead.id,
    left(case when target_lead.id = source_quote.lead_id then source_quote.name || ' (copy)' else source_quote.name end, 120),
    'draft', sums.total_cents, sums.tax_cents, 'proposal', source_quote.line_items,
    source_quote.tax_rate_percent, source_quote.deposit_percent, source_quote.deposit_cents,
    source_quote.intro, source_quote.terms, source_quote.template_id, source_quote.include_company_documents,
    source_quote.packages, source_quote.selected_package_id, source_quote.discount_percent,
    source_quote.discount_cents,
    case when source_quote.valid_until is null then null
      else (now() at time zone coalesce(
        (select nullif(o.timezone, '') from public.organizations o where o.id = source_quote.org_id),
        'America/Toronto'))::date + 30 end,
    jsonb_build_object('created_by', auth.uid(), 'copied_from', source_quote.id), now(), now());

  insert into public.document_assets (
    document_kind, document_id, kind, name, storage_path, mime_type, byte_size, position, created_by)
  select 'proposal', copy_id, a.kind, a.name, a.storage_path, a.mime_type, a.byte_size, a.position, a.created_by
  from public.document_assets a
  where a.document_kind = 'proposal' and a.document_id = source_quote.id;

  if target_lead.status in ('new', 'contacted', 'estimate_scheduled') then
    update public.leads set status = 'estimated', updated_at = now() where id = target_lead.id;
  end if;
  return copy_id;
end
$$;
revoke all on function public.duplicate_proposal(uuid, uuid) from public, anon;
grant execute on function public.duplicate_proposal(uuid, uuid) to authenticated;

create or replace function public.send_proposal(requested_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.quotes%rowtype;
  token text;
begin
  select * into existing from public.quotes where id = requested_id for update;
  if not found then
    raise exception 'Proposal not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(existing.org_id) then
    raise exception 'Only managers can send proposals.' using errcode = '42501';
  end if;
  if existing.status not in ('draft', 'sent', 'declined', 'expired') then
    raise exception 'This proposal was already accepted.' using errcode = '22023';
  end if;
  if jsonb_array_length(existing.line_items) = 0 then
    raise exception 'Add at least one line item before sending.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(existing.packages) p
    where not exists (
      select 1 from jsonb_array_elements(existing.line_items) i where i ->> 'packageId' = p ->> 'id')) then
    raise exception 'Add at least one line item to each package before sending.' using errcode = '22023';
  end if;
  if private.proposal_expired(existing.org_id, existing.valid_until) then
    raise exception 'The valid-until date has passed. Choose a later date before sending.' using errcode = '22023';
  end if;
  perform private.set_acting_org(existing.org_id);
  token := coalesce(existing.public_token, private.new_public_token());
  update public.quotes set status = 'sent', sent_at = now(), public_token = token,
    declined_at = null, decline_reason = null, updated_at = now()
  where id = requested_id;
  update public.leads set status = 'proposal_sent', updated_at = now()
  where id = existing.lead_id
    and status in ('new', 'contacted', 'estimate_scheduled', 'estimated', 'lost');
  return token;
end
$$;

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
  select * into sums from private.line_item_totals(found_quote.line_items, found_quote.tax_rate_percent,
    found_quote.discount_percent, found_quote.discount_cents);
  deposit := coalesce(found_quote.deposit_cents,
    round(sums.total_cents * coalesce(found_quote.deposit_percent, 0) / 100)::bigint);
  return (
    select jsonb_build_object(
      'kind', 'proposal',
      'name', found_quote.name, 'status', found_quote.status,
      'items', found_quote.line_items, 'taxRatePercent', found_quote.tax_rate_percent,
      'subtotalCents', sums.subtotal_cents, 'discountCents', sums.discount_cents,
      'taxCents', sums.tax_cents, 'totalCents', sums.total_cents,
      'discount', jsonb_build_object('percent', found_quote.discount_percent, 'cents', found_quote.discount_cents),
      'packages', found_quote.packages, 'selectedPackageId', found_quote.selected_package_id,
      'validUntil', found_quote.valid_until,
      'expired', found_quote.status = 'sent' and private.proposal_expired(found_quote.org_id, found_quote.valid_until),
      'depositPercent', found_quote.deposit_percent, 'depositCents', deposit,
      'intro', found_quote.intro, 'terms', found_quote.terms,
      'sentAt', found_quote.sent_at, 'signedName', found_quote.signed_name,
      'signedAt', found_quote.signed_at, 'signatureImage', found_quote.signature_image, 'declinedAt', found_quote.declined_at,
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

-- Approving stores the chosen package and add-ons and recalculates the total.
drop function public.accept_public_proposal(text, text, text[], text);
drop function private.accept_proposal(text, text, text[]);
create function private.accept_proposal(
  requested_token text, requested_signer text, requested_selected text[], requested_package text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  found_quote public.quotes%rowtype;
  signer text := btrim(coalesce(requested_signer, ''));
  chosen_package_id text;
  chosen jsonb;
  sums record;
begin
  select * into found_quote from public.quotes
  where public_token = requested_token and char_length(requested_token) >= 24
  for update;
  if not found then
    raise exception 'Proposal not found.' using errcode = 'P0002';
  end if;
  if found_quote.status = 'accepted' then
    return;
  end if;
  if found_quote.status <> 'sent' then
    raise exception 'This proposal is no longer open. Contact us for an updated one.' using errcode = '22023';
  end if;
  if private.proposal_expired(found_quote.org_id, found_quote.valid_until) then
    raise exception 'This proposal expired. Contact us for an updated one.' using errcode = '22023';
  end if;
  if signer = '' or char_length(signer) > 200 then
    raise exception 'Type your full name to sign.' using errcode = '22023';
  end if;
  if jsonb_array_length(found_quote.packages) > 0 then
    select p ->> 'id' into chosen_package_id from jsonb_array_elements(found_quote.packages) p
    where p ->> 'id' = requested_package;
    if chosen_package_id is null then
      raise exception 'Choose one package to approve.' using errcode = '22023';
    end if;
  end if;
  perform set_config('serviceflow.org_id', found_quote.org_id::text, true);

  select coalesce(jsonb_agg(case
      when nullif(e.item ->> 'packageId', '') is not null
        then jsonb_set(e.item, '{selected}', to_jsonb(coalesce((e.item ->> 'packageId') = chosen_package_id, false)))
      when (e.item ->> 'optional')::boolean
        then jsonb_set(e.item, '{selected}',
          to_jsonb((e.item ->> 'id') = any(coalesce(requested_selected, '{}'))))
      else e.item end order by e.position), '[]'::jsonb)
  into chosen
  from jsonb_array_elements(found_quote.line_items) with ordinality as e(item, position);
  select * into sums from private.line_item_totals(chosen, found_quote.tax_rate_percent,
    found_quote.discount_percent, found_quote.discount_cents);

  update public.quotes set line_items = chosen, selected_package_id = chosen_package_id,
    amount_cents = sums.total_cents, tax_cents = sums.tax_cents, status = 'accepted', accepted_at = now(),
    signed_name = signer, signed_at = now(), updated_at = now()
  where id = found_quote.id;
  perform private.draft_deposit_invoice(found_quote.id, private.create_job_from_proposal(found_quote.id));
end
$$;
revoke all on function private.accept_proposal(text, text, text[], text) from public, anon, authenticated;

create function public.accept_public_proposal(
  requested_token text, requested_signer text, requested_selected text[] default '{}',
  requested_signature text default null, requested_package text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.valid_signature_image(requested_signature) and not exists (
    select 1 from public.quotes where public_token = requested_token and status = 'accepted') then
    raise exception 'Draw your signature to accept.' using errcode = '22023';
  end if;
  perform private.accept_proposal(requested_token, requested_signer, requested_selected, requested_package);
  update public.quotes set signature_image = requested_signature
  where public_token = requested_token and char_length(requested_token) >= 24
    and status = 'accepted' and signature_image is null
    and private.valid_signature_image(requested_signature);
end
$$;
revoke all on function public.accept_public_proposal(text, text, text[], text, text) from public;
grant execute on function public.accept_public_proposal(text, text, text[], text, text) to anon, authenticated;

-- The language a customer's document page opens in, from their contact.
create function public.view_public_document_language(requested_kind text, requested_token text)
returns text
language sql stable security definer set search_path = ''
as $$
  select c.preferred_language
  from public.contacts c
  where char_length(requested_token) >= 24
    and c.id = case requested_kind
      when 'proposal' then (
        select l.contact_id from public.quotes q join public.leads l on l.id = q.lead_id
        where q.public_token = requested_token)
      when 'change_order' then (
        select j.contact_id from public.change_orders d join public.jobs j on j.id = d.job_id
        where d.public_token = requested_token)
      when 'invoice' then (
        select j.contact_id from public.invoices d join public.jobs j on j.id = d.job_id
        where d.public_token = requested_token)
    end
$$;
revoke all on function public.view_public_document_language(text, text) from public;
grant execute on function public.view_public_document_language(text, text) to anon, authenticated;

-- Staff choose the language the deal's customer reads documents in.
create function public.set_deal_customer_language(requested_lead uuid, requested_language text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  source_lead public.leads%rowtype;
begin
  select * into source_lead from public.leads where id = requested_lead;
  if not found then
    raise exception 'Deal not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(source_lead.org_id) then
    raise exception 'Only managers can change the customer''s language.' using errcode = '42501';
  end if;
  if requested_language is not null and requested_language not in ('en', 'fr') then
    raise exception 'Choose English or French.' using errcode = '22023';
  end if;
  perform private.set_acting_org(source_lead.org_id);
  update public.contacts set preferred_language = requested_language, updated_at = now()
  where id = source_lead.contact_id and preferred_language is distinct from requested_language;
end
$$;
revoke all on function public.set_deal_customer_language(uuid, text) from public, anon;
grant execute on function public.set_deal_customer_language(uuid, text) to authenticated;

-- Staff of the company opening a customer link (e.g. "Customer view" in the
-- editor) don't count as the customer's first view, so "Viewed" and the
-- viewed notification wait for the customer. Each view function keeps its
-- current definition; only its viewed_at condition gains the guard.
do $$
declare
  target record;
  definition text;
begin
  for target in
    select * from (values
      ('public.view_public_proposal(text)',
       'if found_quote.status = ''sent'' and found_quote.viewed_at is null then',
       'if found_quote.status = ''sent'' and found_quote.viewed_at is null and not private.is_org_member(found_quote.org_id) then'),
      ('public.view_public_change_order(text)',
       'if found_order.status = ''sent'' and found_order.viewed_at is null then',
       'if found_order.status = ''sent'' and found_order.viewed_at is null and not private.is_org_member(found_order.org_id) then'),
      ('public.view_public_invoice(text)',
       'if found_invoice.viewed_at is null then',
       'if found_invoice.viewed_at is null and not private.is_org_member(found_invoice.org_id) then')
    ) v(fn, old_condition, new_condition)
  loop
    definition := pg_get_functiondef(target.fn::regprocedure);
    if position(target.new_condition in definition) > 0 then
      continue;
    end if;
    if position(target.old_condition in definition) = 0 then
      raise exception '% no longer has the expected viewed_at check; add the staff guard by hand.', target.fn;
    end if;
    execute replace(definition, target.old_condition, target.new_condition);
  end loop;
end
$$;


-- Document pages link to the customer's portal (My Proposals, My Invoices,
-- Request Appointment, Email Settings). The link token is created on first
-- use, as get_customer_portal_token does for staff. Only customers get one.
create function private.document_portal_token(requested_contact uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := (select org_id from public.contacts where id = requested_contact and kind = 'customer');
begin
  if company is null then
    return null;
  end if;
  insert into public.customer_portals (contact_id, org_id, token, created_by)
  values (requested_contact, company, private.new_public_token(), null)
  on conflict (contact_id) do nothing;
  return (select token from public.customer_portals where contact_id = requested_contact);
end
$$;
revoke all on function private.document_portal_token(uuid) from public, anon, authenticated;

-- New keys on each customer view: the portal link; on proposals whether the
-- deposit is paid; on invoices its payments, issue date and kind. Each
-- function keeps its current definition otherwise.
do $$
declare
  target record;
  definition text;
begin
  for target in
    select * from (values
      ('public.view_public_proposal(text)',
       $k$'portalToken', private.document_portal_token(c.id),
      'depositPaid', coalesce((
        select bool_and(coalesce((select sum(p.amount_cents) from public.invoice_payments p where p.invoice_id = d.id), 0) >= d.amount_cents)
        from public.invoices d
        where d.source_quote_id = found_quote.id and d.kind = 'deposit' and d.status <> 'void'), false),
      $k$),
      ('public.view_public_change_order(text)',
       $k$'portalToken', private.document_portal_token(c.id),
      $k$),
      ('public.view_public_invoice(text)',
       $k$'portalToken', private.document_portal_token(c.id),
      'invoiceKind', found_invoice.kind, 'issuedOn', found_invoice.issued_on,
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'amountCents', p.amount_cents, 'paidOn', p.paid_on,
            'method', p.method, 'reference', case when p.source = 'manual' then p.reference end)
          order by p.paid_on, p.created_at)
        from public.invoice_payments p where p.invoice_id = found_invoice.id), '[]'::jsonb),
      $k$)
    ) v(fn, keys)
  loop
    definition := pg_get_functiondef(target.fn::regprocedure);
    if position('''portalToken''' in definition) > 0 then
      continue;
    end if;
    if (char_length(definition) - char_length(replace(definition, '''companyDocuments'',', ''))) <> char_length('''companyDocuments'',') then
      raise exception '% no longer has one companyDocuments key; add the portal link by hand.', target.fn;
    end if;
    execute replace(definition, '''companyDocuments'',', target.keys || '''companyDocuments'',');
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
