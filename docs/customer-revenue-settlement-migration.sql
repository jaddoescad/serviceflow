-- Customer revenue evidence and settlement model.
--
-- Source-of-truth rules:
--   * customer_invoices and their children preserve the DripJobs source.
--   * one DripJobs proposal UUID is one accounting job, even when CompanyCam
--     is missing or one CompanyCam project is reused for multiple proposals.
--   * companycam_project_id is a legacy compatibility key. A value such as
--     dripjobs-<proposal id> is used when a separate accounting identity is
--     required; CompanyCam remains supporting operational evidence.
--   * the archived physical invoice subtotal is the pre-HST job value used by
--     project_budgets. Neither the proposal estimate nor invoice gross is used.
--   * financial_transactions remains the bank-ledger source.
--   * customer_invoice_bank_allocations is the only settlement bridge.
--   * allocations are append-only; corrections are explicit reversals.

create extension if not exists pgcrypto;

create table if not exists public.customer_invoices (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'dripjobs',
  external_invoice_id text not null,
  invoice_number text not null,
  companycam_project_id text not null
    references public.companycam_projects(companycam_id) on delete restrict,
  external_proposal_id text,
  external_proposal_uuid text,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  billing_address text,
  job_name text,
  job_address text,
  invoice_date date,
  due_date date,
  currency text not null default 'CAD',
  subtotal numeric(14,2) not null,
  tax_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null,
  source_paid_amount numeric(14,2) not null default 0,
  source_balance numeric(14,2) not null default 0,
  source_status text not null,
  visible_status text,
  salesperson text,
  source_url text,
  is_archived_job boolean not null default false,
  source_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_invoices_source_unique unique (source_system, external_invoice_id),
  constraint customer_invoices_amounts_nonnegative check (
    subtotal >= 0 and tax_amount >= 0 and total_amount >= 0
    and source_paid_amount >= 0
  ),
  constraint customer_invoices_currency_check check (currency in ('CAD', 'USD')),
  constraint customer_invoices_printed_total_check check (
    abs((subtotal + tax_amount) - total_amount) <= 0.02
  )
);

create index if not exists customer_invoices_project_idx
  on public.customer_invoices(companycam_project_id, invoice_date);
create index if not exists customer_invoices_number_idx
  on public.customer_invoices(invoice_number);

create table if not exists public.customer_invoice_items (
  id uuid primary key default gen_random_uuid(),
  customer_invoice_id uuid not null
    references public.customer_invoices(id) on delete restrict,
  source_system text not null default 'dripjobs',
  external_item_id text not null,
  line_number integer not null,
  description text not null,
  quantity numeric(14,4),
  unit_price numeric(14,2),
  amount_before_tax numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  source_text text,
  source_url text,
  source_payload jsonb not null default '{}'::jsonb,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_invoice_items_source_unique
    unique (source_system, external_item_id),
  constraint customer_invoice_items_line_unique
    unique (customer_invoice_id, line_number),
  constraint customer_invoice_items_total_check check (
    abs((amount_before_tax + tax_amount) - total_amount) <= 0.02
  )
);

create index if not exists customer_invoice_items_invoice_idx
  on public.customer_invoice_items(customer_invoice_id, line_number);

create table if not exists public.customer_invoice_payment_events (
  id uuid primary key default gen_random_uuid(),
  customer_invoice_id uuid not null
    references public.customer_invoices(id) on delete restrict,
  source_system text not null default 'dripjobs',
  external_payment_id text not null,
  payment_number text,
  received_on date not null,
  method text,
  reference text,
  amount numeric(14,2) not null,
  currency text not null default 'CAD',
  source_statuses text[] not null default '{}'::text[],
  source_url text,
  source_payload jsonb not null default '{}'::jsonb,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_invoice_payment_events_source_unique
    unique (source_system, external_payment_id),
  constraint customer_invoice_payment_events_amount_nonzero check (amount <> 0),
  constraint customer_invoice_payment_events_currency_check check (currency in ('CAD', 'USD'))
);

create index if not exists customer_invoice_payment_events_invoice_idx
  on public.customer_invoice_payment_events(customer_invoice_id, received_on);

create table if not exists public.customer_invoice_documents (
  id uuid primary key default gen_random_uuid(),
  customer_invoice_id uuid not null
    references public.customer_invoices(id) on delete restrict,
  document_kind text not null default 'original_invoice',
  original_filename text not null,
  storage_bucket text not null,
  storage_path text not null,
  content_type text not null default 'application/pdf',
  size_bytes bigint not null,
  content_sha256 text not null,
  source_url text,
  captured_at timestamptz not null,
  inserted_at timestamptz not null default now(),
  constraint customer_invoice_documents_path_unique
    unique (storage_bucket, storage_path),
  constraint customer_invoice_documents_hash_check
    check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint customer_invoice_documents_size_check check (size_bytes > 0)
);

create index if not exists customer_invoice_documents_invoice_idx
  on public.customer_invoice_documents(customer_invoice_id, captured_at);

create table if not exists public.customer_invoice_bank_allocations (
  id uuid primary key default gen_random_uuid(),
  financial_transaction_id uuid not null
    references public.financial_transactions(id) on delete restrict,
  customer_invoice_id uuid not null
    references public.customer_invoices(id) on delete restrict,
  source_payment_event_id uuid
    references public.customer_invoice_payment_events(id) on delete restrict,
  allocated_amount numeric(14,2) not null,
  match_method text[] not null,
  confidence text not null default 'confirmed',
  evidence_note text not null,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete set null,
  reversal_reason text,
  inserted_at timestamptz not null default now(),
  constraint customer_invoice_bank_allocations_amount_positive
    check (allocated_amount > 0),
  constraint customer_invoice_bank_allocations_confidence_check
    check (confidence in ('confirmed', 'manual')),
  constraint customer_invoice_bank_allocations_reversal_check check (
    (reversed_at is null and reversed_by is null and reversal_reason is null)
    or
    (reversed_at is not null and reversal_reason is not null and length(trim(reversal_reason)) > 0)
  )
);

create index if not exists customer_invoice_bank_allocations_transaction_idx
  on public.customer_invoice_bank_allocations(financial_transaction_id)
  where reversed_at is null;
create index if not exists customer_invoice_bank_allocations_invoice_idx
  on public.customer_invoice_bank_allocations(customer_invoice_id)
  where reversed_at is null;
create unique index if not exists customer_invoice_bank_allocations_active_source_unique
  on public.customer_invoice_bank_allocations(
    financial_transaction_id,
    customer_invoice_id,
    coalesce(source_payment_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where reversed_at is null;

create table if not exists public.customer_revenue_verification_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  action text not null,
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  constraint customer_revenue_events_entity_check check (
    entity_type in ('invoice', 'invoice_item', 'payment_event', 'document', 'bank_allocation')
  )
);

create index if not exists customer_revenue_events_entity_idx
  on public.customer_revenue_verification_events(entity_type, entity_id, occurred_at);

create or replace function public.validate_customer_revenue_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  transaction_row public.financial_transactions%rowtype;
  invoice_row public.customer_invoices%rowtype;
  payment_row public.customer_invoice_payment_events%rowtype;
begin
  if new.reversed_at is not null then
    return new;
  end if;

  select * into transaction_row
  from public.financial_transactions
  where id = new.financial_transaction_id;

  if transaction_row.id is null then
    raise exception 'Financial transaction % does not exist', new.financial_transaction_id;
  end if;
  if transaction_row.amount <= 0
     or transaction_row.transaction_type <> 'income'
     or transaction_row.is_transfer then
    raise exception 'Customer revenue allocations require a positive, non-transfer income transaction';
  end if;
  if transaction_row.category <> 'Painting revenue' then
    raise exception 'Customer revenue allocations require Painting revenue category';
  end if;

  select * into invoice_row
  from public.customer_invoices
  where id = new.customer_invoice_id;

  if invoice_row.id is null then
    raise exception 'Customer invoice % does not exist', new.customer_invoice_id;
  end if;
  if transaction_row.currency <> invoice_row.currency then
    raise exception 'Currency mismatch between transaction and invoice';
  end if;

  if new.source_payment_event_id is not null then
    select * into payment_row
    from public.customer_invoice_payment_events
    where id = new.source_payment_event_id;
    if payment_row.id is null or payment_row.customer_invoice_id <> new.customer_invoice_id then
      raise exception 'Source payment event must belong to the allocated invoice';
    end if;
    if payment_row.currency <> invoice_row.currency then
      raise exception 'Currency mismatch between source payment and invoice';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.validate_customer_revenue_allocation_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  transaction_id uuid := coalesce(new.financial_transaction_id, old.financial_transaction_id);
  invoice_id uuid := coalesce(new.customer_invoice_id, old.customer_invoice_id);
  payment_id uuid := coalesce(new.source_payment_event_id, old.source_payment_event_id);
  transaction_amount numeric;
  invoice_amount numeric;
  payment_amount numeric;
  active_total numeric;
begin
  select amount into transaction_amount
  from public.financial_transactions where id = transaction_id;
  select coalesce(sum(allocated_amount), 0) into active_total
  from public.customer_invoice_bank_allocations
  where financial_transaction_id = transaction_id and reversed_at is null;
  if active_total > transaction_amount + 0.005 then
    raise exception 'Active customer allocations exceed bank transaction amount';
  end if;

  select total_amount into invoice_amount
  from public.customer_invoices where id = invoice_id;
  select coalesce(sum(allocated_amount), 0) into active_total
  from public.customer_invoice_bank_allocations
  where customer_invoice_id = invoice_id and reversed_at is null;
  if active_total > invoice_amount + 0.005 then
    raise exception 'Active bank allocations exceed customer invoice total';
  end if;

  if payment_id is not null then
    select amount into payment_amount
    from public.customer_invoice_payment_events where id = payment_id;
    select coalesce(sum(allocated_amount), 0) into active_total
    from public.customer_invoice_bank_allocations
    where source_payment_event_id = payment_id and reversed_at is null;
    if active_total > payment_amount + 0.005 then
      raise exception 'Active bank allocations exceed source payment-event amount';
    end if;
  end if;

  return null;
end;
$$;

create or replace function public.protect_customer_revenue_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.reversed_at is not null then
    raise exception 'A reversed customer revenue allocation is immutable';
  end if;
  if new.financial_transaction_id <> old.financial_transaction_id
     or new.customer_invoice_id <> old.customer_invoice_id
     or new.source_payment_event_id is distinct from old.source_payment_event_id
     or new.allocated_amount <> old.allocated_amount
     or new.match_method <> old.match_method
     or new.confidence <> old.confidence
     or new.evidence_note <> old.evidence_note
     or new.confirmed_by is distinct from old.confirmed_by
     or new.confirmed_at <> old.confirmed_at
     or new.inserted_at <> old.inserted_at then
    raise exception 'Customer revenue allocations are append-only; reverse and replace instead';
  end if;
  if new.reversed_at is null then
    raise exception 'Allocation updates must record a reversal';
  end if;
  return new;
end;
$$;

create or replace function public.validate_customer_invoice_existing_allocations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_total numeric;
begin
  select coalesce(sum(allocated_amount), 0) into active_total
  from public.customer_invoice_bank_allocations
  where customer_invoice_id = new.id and reversed_at is null;
  if active_total > new.total_amount + 0.005 then
    raise exception 'Updated invoice total is below its active bank allocations';
  end if;
  return new;
end;
$$;

create or replace function public.validate_customer_transaction_existing_allocations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_total numeric;
begin
  select coalesce(sum(allocated_amount), 0) into active_total
  from public.customer_invoice_bank_allocations
  where financial_transaction_id = new.id and reversed_at is null;
  if active_total > 0 and (
    new.amount <= 0 or new.transaction_type <> 'income' or new.is_transfer
    or new.category <> 'Painting revenue'
  ) then
    raise exception 'A transaction with active customer allocations must remain Painting revenue income';
  end if;
  if active_total > new.amount + 0.005 then
    raise exception 'Updated bank amount is below its active customer allocations';
  end if;
  return new;
end;
$$;

create or replace function public.audit_customer_revenue_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  entity_kind text;
  entity_key text;
begin
  entity_kind := case tg_table_name
    when 'customer_invoices' then 'invoice'
    when 'customer_invoice_items' then 'invoice_item'
    when 'customer_invoice_payment_events' then 'payment_event'
    when 'customer_invoice_documents' then 'document'
    when 'customer_invoice_bank_allocations' then 'bank_allocation'
  end;
  entity_key := coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'));
  insert into public.customer_revenue_verification_events(
    entity_type, entity_id, action, evidence, actor_id
  ) values (
    entity_kind,
    entity_key,
    lower(tg_op),
    jsonb_build_object(
      'old', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'new', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    ),
    auth.uid()
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists validate_customer_revenue_allocation on public.customer_invoice_bank_allocations;
create trigger validate_customer_revenue_allocation
before insert on public.customer_invoice_bank_allocations
for each row execute function public.validate_customer_revenue_allocation();

drop trigger if exists protect_customer_revenue_allocation on public.customer_invoice_bank_allocations;
create trigger protect_customer_revenue_allocation
before update on public.customer_invoice_bank_allocations
for each row execute function public.protect_customer_revenue_allocation();

drop trigger if exists validate_customer_revenue_allocation_totals on public.customer_invoice_bank_allocations;
create constraint trigger validate_customer_revenue_allocation_totals
after insert or update on public.customer_invoice_bank_allocations
deferrable initially deferred
for each row execute function public.validate_customer_revenue_allocation_totals();

drop trigger if exists validate_customer_invoice_existing_allocations on public.customer_invoices;
create constraint trigger validate_customer_invoice_existing_allocations
after update of total_amount on public.customer_invoices
deferrable initially deferred
for each row execute function public.validate_customer_invoice_existing_allocations();

drop trigger if exists validate_customer_transaction_existing_allocations on public.financial_transactions;
create constraint trigger validate_customer_transaction_existing_allocations
after update of amount, transaction_type, is_transfer, category on public.financial_transactions
deferrable initially deferred
for each row execute function public.validate_customer_transaction_existing_allocations();

drop trigger if exists customer_invoices_set_updated_at on public.customer_invoices;
create trigger customer_invoices_set_updated_at
before update on public.customer_invoices
for each row execute function public.set_updated_at();
drop trigger if exists customer_invoice_items_set_updated_at on public.customer_invoice_items;
create trigger customer_invoice_items_set_updated_at
before update on public.customer_invoice_items
for each row execute function public.set_updated_at();
drop trigger if exists customer_invoice_payment_events_set_updated_at on public.customer_invoice_payment_events;
create trigger customer_invoice_payment_events_set_updated_at
before update on public.customer_invoice_payment_events
for each row execute function public.set_updated_at();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customer_invoices',
    'customer_invoice_items',
    'customer_invoice_payment_events',
    'customer_invoice_documents',
    'customer_invoice_bank_allocations'
  ] loop
    execute format('drop trigger if exists audit_customer_revenue_change on public.%I', table_name);
    execute format(
      'create trigger audit_customer_revenue_change after insert or update or delete on public.%I for each row execute function public.audit_customer_revenue_change()',
      table_name
    );
  end loop;
end $$;

create or replace view public.customer_invoice_verification
with (security_invoker = true)
as
select
  invoice.id as customer_invoice_id,
  invoice.companycam_project_id,
  invoice.invoice_number,
  invoice.invoice_date,
  invoice.customer_name,
  invoice.currency,
  invoice.subtotal,
  invoice.tax_amount,
  invoice.total_amount,
  invoice.source_paid_amount,
  invoice.source_balance,
  invoice.source_status,
  coalesce(items.item_count, 0)::integer as item_count,
  coalesce(items.item_subtotal, 0)::numeric(14,2) as item_subtotal,
  coalesce(items.item_tax, 0)::numeric(14,2) as item_tax,
  coalesce(items.item_total, 0)::numeric(14,2) as item_total,
  (coalesce(items.item_total, 0) - invoice.total_amount)::numeric(14,2) as item_difference,
  coalesce(documents.document_count, 0)::integer as document_count,
  coalesce(payments.payment_event_count, 0)::integer as payment_event_count,
  coalesce(payments.payment_event_total, 0)::numeric(14,2) as payment_event_total,
  coalesce(bank.bank_payment_count, 0)::integer as bank_payment_count,
  coalesce(bank.bank_paid_amount, 0)::numeric(14,2) as bank_paid_amount,
  (invoice.total_amount - coalesce(bank.bank_paid_amount, 0))::numeric(14,2) as amount_remaining,
  case
    when coalesce(bank.bank_paid_amount, 0) >= invoice.total_amount - 0.005 then 'paid'
    when coalesce(bank.bank_paid_amount, 0) > 0 then 'partially_paid'
    else 'unpaid'
  end as bank_payment_status,
  case
    when coalesce(documents.document_count, 0) = 0 then 'needs_information'
    when abs(coalesce(items.item_total, 0) - invoice.total_amount) > 0.02 then 'needs_review'
    when coalesce(bank.bank_paid_amount, 0) + 0.005 < invoice.source_paid_amount then 'needs_review'
    else 'verified'
  end as verification_status
from public.customer_invoices invoice
left join lateral (
  select
    count(*) as item_count,
    sum(item.amount_before_tax) as item_subtotal,
    sum(item.tax_amount) as item_tax,
    sum(item.total_amount) as item_total
  from public.customer_invoice_items item
  where item.customer_invoice_id = invoice.id
) items on true
left join lateral (
  select count(*) as document_count
  from public.customer_invoice_documents document
  where document.customer_invoice_id = invoice.id
) documents on true
left join lateral (
  select count(*) as payment_event_count, sum(event.amount) as payment_event_total
  from public.customer_invoice_payment_events event
  where event.customer_invoice_id = invoice.id
) payments on true
left join lateral (
  select count(*) as bank_payment_count, sum(allocation.allocated_amount) as bank_paid_amount
  from public.customer_invoice_bank_allocations allocation
  where allocation.customer_invoice_id = invoice.id and allocation.reversed_at is null
) bank on true;

create or replace view public.customer_revenue_verification
with (security_invoker = true)
as
select
  transaction.id as financial_transaction_id,
  transaction.posted_on,
  transaction.amount as bank_amount,
  transaction.currency,
  coalesce(allocation.invoice_count, 0)::integer as invoice_count,
  coalesce(allocation.allocated_amount, 0)::numeric(14,2) as allocated_amount,
  (transaction.amount - coalesce(allocation.allocated_amount, 0))::numeric(14,2) as unallocated_amount,
  case
    when coalesce(allocation.allocated_amount, 0) <= 0 then 'unmatched'
    when coalesce(allocation.allocated_amount, 0) >= transaction.amount - 0.005 then 'fully_allocated'
    else 'partially_allocated'
  end as payment_status
from public.financial_transactions transaction
left join lateral (
  select
    count(distinct bank_allocation.customer_invoice_id) as invoice_count,
    sum(bank_allocation.allocated_amount) as allocated_amount
  from public.customer_invoice_bank_allocations bank_allocation
  where bank_allocation.financial_transaction_id = transaction.id
    and bank_allocation.reversed_at is null
) allocation on true
where transaction.category = 'Painting revenue'
  and transaction.transaction_type = 'income'
  and not transaction.is_transfer;

alter table public.customer_invoices enable row level security;
alter table public.customer_invoice_items enable row level security;
alter table public.customer_invoice_payment_events enable row level security;
alter table public.customer_invoice_documents enable row level security;
alter table public.customer_invoice_bank_allocations enable row level security;
alter table public.customer_revenue_verification_events enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customer_invoices',
    'customer_invoice_items',
    'customer_invoice_payment_events',
    'customer_invoice_documents',
    'customer_invoice_bank_allocations'
  ] loop
    execute format('drop policy if exists "Managers can read %1$s" on public.%1$I', table_name);
    execute format(
      'create policy "Managers can read %1$s" on public.%1$I for select to authenticated using (public.current_employee_role() in (''admin'', ''manager''))',
      table_name
    );
    execute format('drop policy if exists "Managers can insert %1$s" on public.%1$I', table_name);
    execute format(
      'create policy "Managers can insert %1$s" on public.%1$I for insert to authenticated with check (public.current_employee_role() in (''admin'', ''manager''))',
      table_name
    );
    execute format('drop policy if exists "Managers can update %1$s" on public.%1$I', table_name);
    execute format(
      'create policy "Managers can update %1$s" on public.%1$I for update to authenticated using (public.current_employee_role() in (''admin'', ''manager'')) with check (public.current_employee_role() in (''admin'', ''manager''))',
      table_name
    );
  end loop;
end $$;

drop policy if exists "Managers can read customer revenue verification events"
  on public.customer_revenue_verification_events;
create policy "Managers can read customer revenue verification events"
  on public.customer_revenue_verification_events
  for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can insert customer revenue verification events"
  on public.customer_revenue_verification_events;
create policy "Managers can insert customer revenue verification events"
  on public.customer_revenue_verification_events
  for insert to authenticated
  with check (public.current_employee_role() in ('admin', 'manager'));

grant select, insert, update on public.customer_invoices to authenticated;
grant select, insert, update on public.customer_invoice_items to authenticated;
grant select, insert, update on public.customer_invoice_payment_events to authenticated;
grant select, insert, update on public.customer_invoice_documents to authenticated;
grant select, insert, update on public.customer_invoice_bank_allocations to authenticated;
grant select, insert on public.customer_revenue_verification_events to authenticated;
grant select on public.customer_invoice_verification to authenticated;
grant select on public.customer_revenue_verification to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-invoices', 'customer-invoices', false, 52428800, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Managers can read customer invoice files" on storage.objects;
create policy "Managers can read customer invoice files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'customer-invoices'
    and public.current_employee_role() in ('admin', 'manager')
  );

select pg_notify('pgrst', 'reload schema');
