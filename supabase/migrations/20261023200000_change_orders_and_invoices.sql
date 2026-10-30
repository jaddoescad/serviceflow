-- Change orders and customer invoices for jobs. Customers open both from a
-- private link; they accept or decline change orders, and an accepted one
-- adds to the job's contract amount. Invoices record payments here and are
-- not synced to Ottawa Painters' accounting. Jobs locked by the June 1, 2026
-- accounting cutoff take neither.
begin;

create function private.require_open_job(requested_job uuid)
returns public.jobs
language plpgsql security definer set search_path = ''
as $$
declare
  result public.jobs%rowtype;
begin
  select * into result from public.jobs where id = requested_job for update;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(result.org_id) then
    raise exception 'Only managers can bill jobs.' using errcode = '42501';
  end if;
  if public.is_historical_job_accounting_locked(requested_job) then
    raise exception 'This job is locked by the June 1, 2026 accounting cutoff.' using errcode = '22023';
  end if;
  perform private.set_acting_org(result.org_id);
  return result;
end
$$;
revoke all on function private.require_open_job(uuid) from public, anon, authenticated;

create table public.change_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete restrict,
  number integer not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'declined', 'cancelled')),
  line_items jsonb not null default '[]'::jsonb,
  tax_rate_percent numeric(6,3) not null default 13 check (tax_rate_percent between 0 and 100),
  amount_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  intro text check (char_length(intro) <= 10000),
  public_token text unique,
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_name text check (char_length(signed_name) <= 200),
  signed_at timestamptz,
  declined_at timestamptz,
  decline_reason text check (char_length(decline_reason) <= 2000),
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, number)
);
create index change_orders_org_idx on public.change_orders (org_id, updated_at desc);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete restrict,
  number integer not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null default 'standard' check (kind in ('deposit', 'progress', 'final', 'standard')),
  status text not null default 'draft' check (status in ('draft', 'sent', 'void')),
  line_items jsonb not null default '[]'::jsonb,
  tax_rate_percent numeric(6,3) not null default 13 check (tax_rate_percent between 0 and 100),
  amount_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  issued_on date not null default current_date,
  due_on date,
  notes text check (char_length(notes) <= 10000),
  public_token text unique,
  sent_at timestamptz,
  viewed_at timestamptz,
  source_quote_id uuid references public.quotes(id) on delete set null,
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number),
  check (due_on is null or due_on >= issued_on)
);
create index invoices_org_idx on public.invoices (org_id, issued_on desc);
create index invoices_job_idx on public.invoices (job_id);

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null default current_date,
  method text not null check (method in ('e-transfer', 'cheque', 'cash', 'card', 'other')),
  reference text check (char_length(reference) <= 200),
  note text check (char_length(note) <= 2000),
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index invoice_payments_invoice_idx on public.invoice_payments (invoice_id);

alter table public.change_orders enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_payments enable row level security;
revoke all on public.change_orders, public.invoices, public.invoice_payments from anon, authenticated;
grant select on public.change_orders, public.invoices, public.invoice_payments to authenticated;
create policy org_member_read on public.change_orders for select to authenticated
  using (org_id in (select private.my_org_ids()));
create policy org_manager_read on public.invoices for select to authenticated
  using (org_id in (select private.my_managed_org_ids()));
create policy org_manager_read on public.invoice_payments for select to authenticated
  using (org_id in (select private.my_managed_org_ids()));

-- Change orders ----------------------------------------------------------

create function public.save_change_order(
  requested_id uuid, requested_job uuid, requested_name text, requested_items jsonb,
  requested_tax_rate numeric, requested_intro text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  job public.jobs%rowtype := private.require_open_job(requested_job);
  existing public.change_orders%rowtype;
  clean_items jsonb := private.clean_line_items(requested_items);
  sums record;
begin
  select * into sums from private.line_item_totals(clean_items, requested_tax_rate);
  select * into existing from public.change_orders where id = requested_id for update;
  if found then
    if existing.job_id <> requested_job then
      raise exception 'Change order belongs to another job.' using errcode = '42501';
    end if;
    if existing.status not in ('draft', 'sent', 'declined') then
      raise exception 'Accepted or cancelled change orders can''t be edited.' using errcode = '22023';
    end if;
    update public.change_orders set name = btrim(requested_name), line_items = clean_items,
      tax_rate_percent = coalesce(requested_tax_rate, 0), amount_cents = sums.total_cents,
      tax_cents = sums.tax_cents, intro = nullif(btrim(requested_intro), ''), updated_at = now()
    where id = requested_id;
  else
    insert into public.change_orders (
      id, org_id, job_id, number, name, line_items, tax_rate_percent, amount_cents, tax_cents, intro)
    values (
      requested_id, job.org_id, requested_job,
      coalesce((select max(number) from public.change_orders where job_id = requested_job), 0) + 1,
      btrim(requested_name), clean_items, coalesce(requested_tax_rate, 0), sums.total_cents,
      sums.tax_cents, nullif(btrim(requested_intro), ''));
  end if;
  return requested_id;
end
$$;

create function private.change_order_for_manager(requested_id uuid)
returns public.change_orders
language plpgsql security definer set search_path = ''
as $$
declare
  result public.change_orders%rowtype;
begin
  select * into result from public.change_orders where id = requested_id for update;
  if not found then
    raise exception 'Change order not found.' using errcode = 'P0002';
  end if;
  perform private.require_open_job(result.job_id);
  return result;
end
$$;
revoke all on function private.change_order_for_manager(uuid) from public, anon, authenticated;

create function public.send_change_order(requested_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.change_orders%rowtype := private.change_order_for_manager(requested_id);
  token text := coalesce(existing.public_token, private.new_public_token());
begin
  if existing.status not in ('draft', 'sent', 'declined') then
    raise exception 'This change order is already %.', existing.status using errcode = '22023';
  end if;
  if jsonb_array_length(existing.line_items) = 0 then
    raise exception 'Add at least one line item before sending.' using errcode = '22023';
  end if;
  update public.change_orders set status = 'sent', sent_at = now(), public_token = token,
    declined_at = null, decline_reason = null, updated_at = now()
  where id = requested_id;
  return token;
end
$$;

create function public.set_change_order_closed(requested_id uuid, requested_action text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.change_orders%rowtype := private.change_order_for_manager(requested_id);
begin
  if requested_action = 'delete' then
    if existing.status <> 'draft' then
      raise exception 'Only unsent change orders can be deleted.' using errcode = '22023';
    end if;
    delete from public.change_orders where id = requested_id;
  elsif requested_action = 'cancel' then
    if existing.status = 'accepted' then
      raise exception 'Accepted change orders can''t be cancelled.' using errcode = '22023';
    end if;
    update public.change_orders set status = 'cancelled', updated_at = now() where id = requested_id;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
end
$$;

create function public.view_public_change_order(requested_token text)
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
      'company', jsonb_build_object('name', o.name, 'phone', o.phone, 'address', o.address))
    from public.jobs j
    join public.contacts c on c.id = j.contact_id
    join public.organizations o on o.id = j.org_id
    where j.id = found_order.job_id);
end
$$;

create function public.accept_public_change_order(
  requested_token text, requested_signer text, requested_selected text[] default '{}')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  found_order public.change_orders%rowtype;
  signer text := btrim(coalesce(requested_signer, ''));
  chosen jsonb;
  sums record;
  new_amount bigint;
begin
  select * into found_order from public.change_orders
  where public_token = requested_token and char_length(requested_token) >= 24
  for update;
  if not found then
    raise exception 'Change order not found.' using errcode = 'P0002';
  end if;
  if found_order.status = 'accepted' then
    return;
  end if;
  if found_order.status <> 'sent' then
    raise exception 'This change order is no longer open.' using errcode = '22023';
  end if;
  if signer = '' or char_length(signer) > 200 then
    raise exception 'Type your full name to sign.' using errcode = '22023';
  end if;
  perform set_config('serviceflow.org_id', found_order.org_id::text, true);

  select coalesce(jsonb_agg(case when (e.item ->> 'optional')::boolean
      then jsonb_set(e.item, '{selected}',
        to_jsonb((e.item ->> 'id') = any(coalesce(requested_selected, '{}'))))
      else e.item end order by e.position), '[]'::jsonb)
  into chosen
  from jsonb_array_elements(found_order.line_items) with ordinality as e(item, position);
  select * into sums from private.line_item_totals(chosen, found_order.tax_rate_percent);

  update public.change_orders set line_items = chosen, amount_cents = sums.total_cents,
    tax_cents = sums.tax_cents, status = 'accepted', signed_name = signer, signed_at = now(),
    updated_at = now()
  where id = found_order.id;
  update public.jobs set contract_amount_cents = contract_amount_cents + sums.total_cents,
    updated_at = now()
  where id = found_order.job_id
  returning contract_amount_cents into new_amount;
  perform private.ensure_default_job_budget(found_order.job_id, new_amount);
end
$$;

create function public.decline_public_change_order(requested_token text, requested_reason text default '')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  found_order public.change_orders%rowtype;
begin
  select * into found_order from public.change_orders
  where public_token = requested_token and char_length(requested_token) >= 24
  for update;
  if not found then
    raise exception 'Change order not found.' using errcode = 'P0002';
  end if;
  if found_order.status = 'declined' then
    return;
  end if;
  if found_order.status <> 'sent' then
    raise exception 'This change order is no longer open.' using errcode = '22023';
  end if;
  update public.change_orders set status = 'declined', declined_at = now(),
    decline_reason = left(nullif(btrim(requested_reason), ''), 2000), updated_at = now()
  where id = found_order.id;
end
$$;

-- Invoices ---------------------------------------------------------------

create function private.next_invoice_number(company uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.organizations where id = company for update;
  return coalesce((select max(number) from public.invoices where org_id = company), 1000) + 1;
end
$$;
revoke all on function private.next_invoice_number(uuid) from public, anon, authenticated;

create function public.save_invoice(
  requested_id uuid, requested_job uuid, requested_name text, requested_kind text,
  requested_items jsonb, requested_tax_rate numeric, requested_issued_on date,
  requested_due_on date, requested_notes text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  job public.jobs%rowtype := private.require_open_job(requested_job);
  existing public.invoices%rowtype;
  clean_items jsonb := private.clean_line_items(requested_items);
  sums record;
begin
  select * into sums from private.line_item_totals(clean_items, requested_tax_rate);
  select * into existing from public.invoices where id = requested_id for update;
  if found then
    if existing.job_id <> requested_job then
      raise exception 'Invoice belongs to another job.' using errcode = '42501';
    end if;
    if existing.status = 'void' then
      raise exception 'Void invoices can''t be edited.' using errcode = '22023';
    end if;
    if sums.total_cents < (select coalesce(sum(amount_cents), 0) from public.invoice_payments where invoice_id = requested_id) then
      raise exception 'The total can''t be less than the payments already recorded.' using errcode = '22023';
    end if;
    update public.invoices set name = btrim(requested_name), kind = requested_kind,
      line_items = clean_items, tax_rate_percent = coalesce(requested_tax_rate, 0),
      amount_cents = sums.total_cents, tax_cents = sums.tax_cents,
      issued_on = coalesce(requested_issued_on, issued_on), due_on = requested_due_on,
      notes = nullif(btrim(requested_notes), ''), updated_at = now()
    where id = requested_id;
  else
    insert into public.invoices (
      id, org_id, job_id, number, name, kind, line_items, tax_rate_percent, amount_cents,
      tax_cents, issued_on, due_on, notes)
    values (
      requested_id, job.org_id, requested_job, private.next_invoice_number(job.org_id),
      btrim(requested_name), requested_kind, clean_items, coalesce(requested_tax_rate, 0),
      sums.total_cents, sums.tax_cents, coalesce(requested_issued_on, current_date),
      requested_due_on, nullif(btrim(requested_notes), ''));
  end if;
  return requested_id;
end
$$;

create function private.invoice_for_manager(requested_id uuid)
returns public.invoices
language plpgsql security definer set search_path = ''
as $$
declare
  result public.invoices%rowtype;
begin
  select * into result from public.invoices where id = requested_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  perform private.require_open_job(result.job_id);
  return result;
end
$$;
revoke all on function private.invoice_for_manager(uuid) from public, anon, authenticated;

create function public.send_invoice(requested_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.invoices%rowtype := private.invoice_for_manager(requested_id);
  token text := coalesce(existing.public_token, private.new_public_token());
begin
  if existing.status = 'void' then
    raise exception 'Void invoices can''t be sent.' using errcode = '22023';
  end if;
  if jsonb_array_length(existing.line_items) = 0 then
    raise exception 'Add at least one line item before sending.' using errcode = '22023';
  end if;
  update public.invoices set status = 'sent', sent_at = now(), public_token = token, updated_at = now()
  where id = requested_id;
  return token;
end
$$;

create function public.set_invoice_closed(requested_id uuid, requested_action text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.invoices%rowtype := private.invoice_for_manager(requested_id);
  has_payments boolean := exists (select 1 from public.invoice_payments where invoice_id = requested_id);
begin
  if requested_action = 'delete' then
    if existing.status <> 'draft' or has_payments then
      raise exception 'Only unsent invoices without payments can be deleted.' using errcode = '22023';
    end if;
    delete from public.invoices where id = requested_id;
  elsif requested_action = 'void' then
    if has_payments then
      raise exception 'Remove the payments before voiding this invoice.' using errcode = '22023';
    end if;
    update public.invoices set status = 'void', updated_at = now() where id = requested_id;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
end
$$;

create function public.record_invoice_payment(
  requested_invoice uuid, requested_amount_cents bigint, requested_paid_on date,
  requested_method text, requested_reference text default '', requested_note text default '')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.invoices%rowtype := private.invoice_for_manager(requested_invoice);
  paid bigint := (select coalesce(sum(amount_cents), 0) from public.invoice_payments where invoice_id = requested_invoice);
  payment_id uuid := gen_random_uuid();
begin
  if existing.status = 'void' then
    raise exception 'Void invoices can''t take payments.' using errcode = '22023';
  end if;
  if requested_amount_cents is null or requested_amount_cents <= 0 then
    raise exception 'Enter the amount received.' using errcode = '22023';
  end if;
  if paid + requested_amount_cents > existing.amount_cents then
    raise exception 'That is more than the % still owing.',
      to_char((existing.amount_cents - paid) / 100.0, 'FM$999,999,990.00') using errcode = '22023';
  end if;
  insert into public.invoice_payments (id, org_id, invoice_id, amount_cents, paid_on, method, reference, note)
  values (payment_id, existing.org_id, requested_invoice, requested_amount_cents,
    coalesce(requested_paid_on, current_date), requested_method,
    nullif(btrim(requested_reference), ''), nullif(btrim(requested_note), ''));
  -- Recording a payment means the customer has the invoice.
  if existing.status = 'draft' then
    update public.invoices set status = 'sent', sent_at = coalesce(sent_at, now()),
      public_token = coalesce(public_token, private.new_public_token()), updated_at = now()
    where id = requested_invoice;
  else
    update public.invoices set updated_at = now() where id = requested_invoice;
  end if;
  return payment_id;
end
$$;

create function public.delete_invoice_payment(requested_payment uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  invoice uuid := (select invoice_id from public.invoice_payments where id = requested_payment);
begin
  if invoice is null then
    return;
  end if;
  perform private.invoice_for_manager(invoice);
  delete from public.invoice_payments where id = requested_payment;
  update public.invoices set updated_at = now() where id = invoice;
end
$$;

-- Payment status is derived: void and draft as stored, then paid, partially
-- paid, late (past due) or open.
create function private.invoice_state(
  stored_status text, amount bigint, paid bigint, due date)
returns text
language sql stable set search_path = ''
as $$
  select case
    when stored_status in ('void', 'draft') then stored_status
    when paid >= amount then 'paid'
    when due is not null and due < current_date then 'late'
    when paid > 0 then 'partial'
    else 'open'
  end
$$;
revoke all on function private.invoice_state(text, bigint, bigint, date) from public, anon, authenticated;

create function public.get_invoices(requested_job uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := coalesce((select org_id from public.jobs where id = requested_job), private.home_org_id());
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see invoices.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'jobId', i.job_id, 'number', i.number, 'name', i.name, 'kind', i.kind,
      'status', private.invoice_state(i.status, i.amount_cents, p.paid, i.due_on),
      'amountCents', i.amount_cents, 'paidCents', p.paid, 'balanceCents', i.amount_cents - p.paid,
      'issuedOn', i.issued_on, 'dueOn', i.due_on, 'sentAt', i.sent_at,
      'customerName', c.name, 'jobName', j.name) order by i.issued_on desc, i.number desc)
    from public.invoices i
    join public.jobs j on j.id = i.job_id
    left join public.contacts c on c.id = j.contact_id
    cross join lateral (
      select coalesce(sum(amount_cents), 0)::bigint as paid
      from public.invoice_payments where invoice_id = i.id) p
    where i.org_id = company and (requested_job is null or i.job_id = requested_job)
  ), '[]'::jsonb);
end
$$;

create function public.view_public_invoice(requested_token text)
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
      'company', jsonb_build_object('name', o.name, 'phone', o.phone, 'address', o.address))
    from public.jobs j
    join public.contacts c on c.id = j.contact_id
    join public.organizations o on o.id = j.org_id
    where j.id = found_invoice.job_id);
end
$$;

-- An accepted proposal with a deposit drafts the deposit invoice.
create function private.draft_deposit_invoice(requested_quote uuid, requested_job uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  source_quote public.quotes%rowtype;
  amount bigint;
begin
  select * into source_quote from public.quotes where id = requested_quote;
  amount := coalesce(source_quote.deposit_cents,
    round(source_quote.amount_cents * coalesce(source_quote.deposit_percent, 0) / 100)::bigint);
  if amount <= 0 or exists (select 1 from public.invoices where source_quote_id = requested_quote) then
    return;
  end if;
  insert into public.invoices (
    org_id, job_id, number, name, kind, line_items, tax_rate_percent, amount_cents, tax_cents,
    issued_on, due_on, source_quote_id)
  values (
    source_quote.org_id, requested_job, private.next_invoice_number(source_quote.org_id), 'Deposit',
    'deposit',
    jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text, 'name', 'Deposit',
      'description', format('Deposit for %s (tax included)', source_quote.name),
      'quantity', 1, 'unitPriceCents', amount, 'optional', false, 'selected', true)),
    0, amount, 0, current_date, current_date, requested_quote);
end
$$;
revoke all on function private.draft_deposit_invoice(uuid, uuid) from public, anon, authenticated;

create or replace function public.accept_public_proposal(
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
  perform private.draft_deposit_invoice(found_quote.id, private.create_job_from_proposal(found_quote.id));
end
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'save_change_order(uuid, uuid, text, jsonb, numeric, text)',
    'send_change_order(uuid)',
    'set_change_order_closed(uuid, text)',
    'save_invoice(uuid, uuid, text, text, jsonb, numeric, date, date, text)',
    'send_invoice(uuid)',
    'set_invoice_closed(uuid, text)',
    'record_invoice_payment(uuid, bigint, date, text, text, text)',
    'delete_invoice_payment(uuid)',
    'get_invoices(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  foreach fn in array array[
    'view_public_change_order(text)',
    'accept_public_change_order(text, text, text[])',
    'decline_public_change_order(text, text)',
    'view_public_invoice(text)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to anon, authenticated', fn);
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
