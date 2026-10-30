-- Proposals: line-item quotes a customer opens from a private link, signs and
-- accepts (creating the job) or declines. They live on public.quotes so jobs
-- keep pointing at accepted_quote_id. Templates prefill new proposals.
begin;

-- Line items shared by proposals, change orders and invoices:
-- {id, name, description, quantity, unitPriceCents, optional, selected}.
-- Optional items count only when the customer selects them.
create function private.clean_line_items(items jsonb)
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  item jsonb;
  quantity numeric;
  unit_price numeric;
  is_optional boolean;
  result jsonb := '[]'::jsonb;
begin
  if items is null then
    return result;
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 200 then
    raise exception 'A document holds up to 200 line items.' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(items) loop
    begin
      quantity := coalesce(nullif(item ->> 'quantity', '')::numeric, 1);
      unit_price := coalesce(nullif(item ->> 'unitPriceCents', '')::numeric, 0);
      is_optional := coalesce((item ->> 'optional')::boolean, false);
    exception when others then
      raise exception 'Check the quantity and price of each line item.' using errcode = '22023';
    end;
    if nullif(btrim(item ->> 'name'), '') is null or char_length(item ->> 'name') > 200
      or char_length(coalesce(item ->> 'description', '')) > 4000 then
      raise exception 'Each line item needs a name of up to 200 characters.' using errcode = '22023';
    end if;
    if quantity < 0 or quantity > 100000 or abs(unit_price) > 100000000 then
      raise exception 'Check the quantity and price of each line item.' using errcode = '22023';
    end if;
    result := result || jsonb_build_object(
      'id', coalesce(nullif(item ->> 'id', ''), gen_random_uuid()::text),
      'name', btrim(item ->> 'name'),
      'description', coalesce(item ->> 'description', ''),
      'quantity', round(quantity, 3),
      'unitPriceCents', round(unit_price)::bigint,
      'optional', is_optional,
      'selected', case when is_optional then coalesce((item ->> 'selected')::boolean, false) else true end);
  end loop;
  return result;
end
$$;
revoke all on function private.clean_line_items(jsonb) from public, anon, authenticated;

create function private.line_item_totals(
  items jsonb, tax_rate numeric,
  out subtotal_cents bigint, out tax_cents bigint, out total_cents bigint)
language sql immutable set search_path = ''
as $$
  with sums as (
    select coalesce(sum(round((i ->> 'quantity')::numeric * (i ->> 'unitPriceCents')::numeric)), 0) as subtotal
    from jsonb_array_elements(coalesce(items, '[]'::jsonb)) i
    where not (i ->> 'optional')::boolean or (i ->> 'selected')::boolean
  )
  select subtotal::bigint,
    round(subtotal * coalesce(tax_rate, 0) / 100)::bigint,
    (subtotal + round(subtotal * coalesce(tax_rate, 0) / 100))::bigint
  from sums
$$;
revoke all on function private.line_item_totals(jsonb, numeric) from public, anon, authenticated;

create function private.new_public_token()
returns text
language sql volatile set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_')
$$;
revoke all on function private.new_public_token() from public, anon, authenticated;

alter table public.quotes
  add column line_items jsonb not null default '[]'::jsonb,
  add column tax_rate_percent numeric(6,3) not null default 13
    check (tax_rate_percent between 0 and 100),
  add column deposit_percent numeric(6,3) check (deposit_percent between 0 and 100),
  add column deposit_cents bigint check (deposit_cents >= 0),
  add column intro text check (char_length(intro) <= 10000),
  add column terms text check (char_length(terms) <= 20000),
  add column public_token text unique,
  add column sent_at timestamptz,
  add column viewed_at timestamptz,
  add column signed_name text check (char_length(signed_name) <= 200),
  add column signed_at timestamptz,
  add column declined_at timestamptz,
  add column decline_reason text check (char_length(decline_reason) <= 2000),
  add column template_id uuid,
  add constraint quotes_one_deposit_kind check (deposit_percent is null or deposit_cents is null);

create table public.proposal_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default private.home_org_id()
    references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  line_items jsonb not null default '[]'::jsonb,
  tax_rate_percent numeric(6,3) not null default 13 check (tax_rate_percent between 0 and 100),
  deposit_percent numeric(6,3) check (deposit_percent between 0 and 100),
  deposit_cents bigint check (deposit_cents >= 0),
  intro text check (char_length(intro) <= 10000),
  terms text check (char_length(terms) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (deposit_percent is null or deposit_cents is null)
);
create index proposal_templates_org_idx on public.proposal_templates (org_id, name);

alter table public.proposal_templates enable row level security;
revoke all on public.proposal_templates from anon, authenticated;
grant select, delete on public.proposal_templates to authenticated;
create policy org_member_read on public.proposal_templates for select to authenticated
  using (org_id in (select private.my_org_ids()));
create policy org_manager_delete on public.proposal_templates for delete to authenticated
  using (org_id in (select private.my_managed_org_ids()));

create function public.save_proposal_template(
  requested_id uuid, requested_name text, requested_items jsonb, requested_tax_rate numeric,
  requested_deposit_percent numeric, requested_deposit_cents bigint,
  requested_intro text, requested_terms text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := coalesce(
    (select org_id from public.proposal_templates where id = requested_id),
    private.home_org_id());
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can edit templates.' using errcode = '42501';
  end if;
  insert into public.proposal_templates as t (
    id, org_id, name, line_items, tax_rate_percent, deposit_percent, deposit_cents, intro, terms)
  values (
    requested_id, company, btrim(requested_name), private.clean_line_items(requested_items),
    coalesce(requested_tax_rate, 0), requested_deposit_percent, requested_deposit_cents,
    nullif(btrim(requested_intro), ''), nullif(btrim(requested_terms), ''))
  on conflict (id) do update set
    name = excluded.name, line_items = excluded.line_items,
    tax_rate_percent = excluded.tax_rate_percent, deposit_percent = excluded.deposit_percent,
    deposit_cents = excluded.deposit_cents, intro = excluded.intro, terms = excluded.terms,
    updated_at = now()
  where t.org_id = company;
  return requested_id;
end
$$;
revoke all on function public.save_proposal_template(uuid, text, jsonb, numeric, numeric, bigint, text, text) from public, anon;
grant execute on function public.save_proposal_template(uuid, text, jsonb, numeric, numeric, bigint, text, text) to authenticated;

-- Saving keeps the stored total in step with the line items. A new draft
-- moves an early deal to In Draft.
create function public.save_proposal(
  requested_id uuid, requested_lead uuid, requested_name text, requested_items jsonb,
  requested_tax_rate numeric, requested_deposit_percent numeric, requested_deposit_cents bigint,
  requested_intro text, requested_terms text, requested_template uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  source_lead public.leads%rowtype;
  existing public.quotes%rowtype;
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
  clean_items := private.clean_line_items(requested_items);
  select * into sums from private.line_item_totals(clean_items, requested_tax_rate);

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
      amount_cents = sums.total_cents, tax_cents = sums.tax_cents, updated_at = now()
    where id = requested_id;
  else
    insert into public.quotes (
      id, lead_id, name, status, amount_cents, tax_cents, source, line_items, tax_rate_percent,
      deposit_percent, deposit_cents, intro, terms, template_id, metadata, created_at, updated_at)
    values (
      requested_id, requested_lead, coalesce(nullif(btrim(requested_name), ''), 'Proposal'), 'draft',
      sums.total_cents, sums.tax_cents, 'proposal', clean_items, coalesce(requested_tax_rate, 0),
      requested_deposit_percent, requested_deposit_cents, nullif(btrim(requested_intro), ''),
      nullif(btrim(requested_terms), ''), requested_template,
      jsonb_build_object('created_by', auth.uid()), now(), now());
    if source_lead.status in ('new', 'contacted', 'estimate_scheduled') then
      update public.leads set status = 'estimated', updated_at = now() where id = source_lead.id;
    end if;
  end if;
  return requested_id;
end
$$;
revoke all on function public.save_proposal(uuid, uuid, text, jsonb, numeric, numeric, bigint, text, text, uuid) from public, anon;
grant execute on function public.save_proposal(uuid, uuid, text, jsonb, numeric, numeric, bigint, text, text, uuid) to authenticated;

create function public.delete_proposal(requested_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.quotes%rowtype;
begin
  select * into existing from public.quotes where id = requested_id for update;
  if not found then
    return;
  end if;
  if not private.is_org_manager(existing.org_id) then
    raise exception 'Only managers can delete proposals.' using errcode = '42501';
  end if;
  if existing.status <> 'draft' or existing.source <> 'proposal' then
    raise exception 'Only unsent proposals can be deleted.' using errcode = '22023';
  end if;
  perform private.set_acting_org(existing.org_id);
  delete from public.quotes where id = requested_id;
end
$$;
revoke all on function public.delete_proposal(uuid) from public, anon;
grant execute on function public.delete_proposal(uuid) to authenticated;

-- Marks the proposal sent, gives it a customer link and moves the deal to
-- Proposal(s) Sent. Returns the link token.
create function public.send_proposal(requested_id uuid)
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
revoke all on function public.send_proposal(uuid) from public, anon;
grant execute on function public.send_proposal(uuid) to authenticated;

-- The accepted proposal's job, created once. A quote-less job from a first
-- field clock-in is reused, as convert_lead_to_job does.
create function private.create_job_from_proposal(requested_quote uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  source_quote public.quotes%rowtype;
  source_lead public.leads%rowtype;
  customer_name text;
  job_id uuid;
begin
  select * into source_quote from public.quotes where id = requested_quote;
  select * into source_lead from public.leads where id = source_quote.lead_id for update;
  select id into job_id from public.jobs where accepted_quote_id = requested_quote;
  if job_id is not null then
    return job_id;
  end if;
  select nullif(btrim(name), '') into customer_name from public.contacts where id = source_lead.contact_id;

  select id into job_id from public.jobs
  where lead_id = source_lead.id and accepted_quote_id is null and status in ('scheduled', 'active')
  order by (status = 'active') desc, created_at
  limit 1 for update;

  if job_id is not null then
    update public.jobs set accepted_quote_id = requested_quote,
      contract_amount_cents = source_quote.amount_cents, updated_at = now()
    where id = job_id;
  else
    job_id := gen_random_uuid();
    insert into public.jobs (
      id, contact_id, lead_id, accepted_quote_id, name, status, contract_amount_cents,
      address_line_1, city, province, postal_code, formatted_address, source, metadata)
    values (
      job_id, source_lead.contact_id, source_lead.id, requested_quote,
      coalesce(customer_name, source_quote.name), 'scheduled', source_quote.amount_cents,
      source_lead.address, source_lead.city, source_lead.province, source_lead.postal_code,
      source_lead.address, 'proposal', jsonb_build_object('accepted_quote_id', requested_quote));
  end if;

  update public.leads set status = 'won', updated_at = now() where id = source_lead.id;
  perform private.ensure_default_job_budget(job_id, source_quote.amount_cents);
  return job_id;
end
$$;
revoke all on function private.create_job_from_proposal(uuid) from public, anon, authenticated;

-- What the customer sees. Opening a sent proposal records the first view.
create function public.view_public_proposal(requested_token text)
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
      'company', jsonb_build_object('name', o.name, 'phone', o.phone, 'address', o.address))
    from public.leads l
    join public.contacts c on c.id = l.contact_id
    join public.organizations o on o.id = found_quote.org_id
    where l.id = found_quote.lead_id);
end
$$;
revoke all on function public.view_public_proposal(text) from public;
grant execute on function public.view_public_proposal(text) to anon, authenticated;

create function public.accept_public_proposal(
  requested_token text, requested_signer text, requested_selected text[] default '{}')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  found_quote public.quotes%rowtype;
  signer text := btrim(coalesce(requested_signer, ''));
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
  if signer = '' or char_length(signer) > 200 then
    raise exception 'Type your full name to sign.' using errcode = '22023';
  end if;
  perform set_config('serviceflow.org_id', found_quote.org_id::text, true);

  select coalesce(jsonb_agg(case when (e.item ->> 'optional')::boolean
      then jsonb_set(e.item, '{selected}',
        to_jsonb((e.item ->> 'id') = any(coalesce(requested_selected, '{}'))))
      else e.item end order by e.position), '[]'::jsonb)
  into chosen
  from jsonb_array_elements(found_quote.line_items) with ordinality as e(item, position);
  select * into sums from private.line_item_totals(chosen, found_quote.tax_rate_percent);

  update public.quotes set line_items = chosen, amount_cents = sums.total_cents,
    tax_cents = sums.tax_cents, status = 'accepted', accepted_at = now(),
    signed_name = signer, signed_at = now(), updated_at = now()
  where id = found_quote.id;
  perform private.create_job_from_proposal(found_quote.id);
end
$$;
revoke all on function public.accept_public_proposal(text, text, text[]) from public;
grant execute on function public.accept_public_proposal(text, text, text[]) to anon, authenticated;

create function public.decline_public_proposal(requested_token text, requested_reason text default '')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  found_quote public.quotes%rowtype;
begin
  select * into found_quote from public.quotes
  where public_token = requested_token and char_length(requested_token) >= 24
  for update;
  if not found then
    raise exception 'Proposal not found.' using errcode = 'P0002';
  end if;
  if found_quote.status = 'declined' then
    return;
  end if;
  if found_quote.status <> 'sent' then
    raise exception 'This proposal is no longer open.' using errcode = '22023';
  end if;
  perform set_config('serviceflow.org_id', found_quote.org_id::text, true);
  update public.quotes set status = 'declined', declined_at = now(),
    decline_reason = left(nullif(btrim(requested_reason), ''), 2000), updated_at = now()
  where id = found_quote.id;
  update public.leads set status = 'lost', updated_at = now()
  where id = found_quote.lead_id and status in ('estimated', 'proposal_sent');
end
$$;
revoke all on function public.decline_public_proposal(text, text) from public;
grant execute on function public.decline_public_proposal(text, text) to anon, authenticated;

-- Pipeline cards show when they last moved, not only when the record changed.
create or replace function public.get_pipeline_board(requested_pipeline text, include_closed boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  result jsonb;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can open the pipeline.' using errcode = '42501';
  end if;
  if requested_pipeline not in ('sales', 'jobs') then
    raise exception 'Unknown pipeline.' using errcode = '22023';
  end if;

  with records as (
    select l.id, greatest(l.updated_at, pp.moved_at) as updated_at, l.status, l.source, l.address,
      coalesce(nullif(btrim(c.name), ''), 'Unnamed lead') as name,
      l.estimate_appointment_on as date_on,
      q.id as quote_id, q.status as quote_status, q.amount_cents as value_cents,
      coalesce(
        (select ps.id from public.pipeline_stages ps
         where ps.id = pp.stage_id and ps.record_status = l.status),
        private.derived_pipeline_stage(l.org_id, 'sales', l.status, l.pipeline_stage_raw,
          l.status = 'lost' and q.id is not null)) as stage_id
    from public.leads l
    left join public.contacts c on c.id = l.contact_id
    left join public.pipeline_placements pp on pp.record_id = l.id
    left join lateral (
      select q.id, q.status, q.amount_cents from public.quotes q
      where q.lead_id = l.id and q.status <> 'superseded'
      order by (q.status in ('sent', 'accepted')) desc, q.updated_at desc
      limit 1
    ) q on true
    where requested_pipeline = 'sales' and l.org_id = company
      and l.status not in ('won', 'cancelled')
    union all
    select j.id, greatest(j.updated_at, pp.moved_at), j.status, l.source,
      coalesce(j.formatted_address, j.address_line_1),
      j.name, j.scheduled_on, j.accepted_quote_id, null, j.contract_amount_cents,
      coalesce(
        (select ps.id from public.pipeline_stages ps
         where ps.id = pp.stage_id and ps.record_status = j.status),
        private.derived_pipeline_stage(j.org_id, 'jobs', j.status, null,
          j.status = 'completed' or (j.status = 'scheduled' and j.scheduled_on is not null)))
    from public.jobs j
    left join public.leads l on l.id = j.lead_id
    left join public.pipeline_placements pp on pp.record_id = j.id
    where requested_pipeline = 'jobs' and j.org_id = company
      and j.status in ('scheduled', 'active', 'completed')
      and j.archived_at is null and j.is_feed_visible is not false
  ), stages as (
    select s.*,
      (select count(*) from records r where r.stage_id = s.id) as card_count,
      (select coalesce(sum(r.value_cents), 0) from records r where r.stage_id = s.id) as value_cents
    from public.pipeline_stages s
    where s.org_id = company and s.pipeline = requested_pipeline
  )
  select jsonb_build_object(
    'pipeline', requested_pipeline,
    'stages', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'position', s.position, 'isClosed', s.is_closed,
        'count', s.card_count, 'valueCents', s.value_cents) order by s.position)
      from stages s), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'stageId', r.stage_id, 'name', r.name, 'source', r.source,
        'address', r.address, 'dateOn', r.date_on, 'valueCents', r.value_cents,
        'quoteId', r.quote_id, 'quoteStatus', r.quote_status, 'updatedAt', r.updated_at,
        'labels', coalesce((select jsonb_agg(jsonb_build_object(
            'id', pl.id, 'name', pl.name, 'color', pl.color) order by pl.name)
          from public.project_label_links ll
          join public.project_labels pl on pl.id = ll.label_id
          where ll.project_id = r.id), '[]'::jsonb))
        order by r.updated_at desc, r.id)
      from records r join stages s on s.id = r.stage_id
      where include_closed or not s.is_closed), '[]'::jsonb)
  ) into result;
  return result;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
