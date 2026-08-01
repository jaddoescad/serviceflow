-- A processor payout is net cash while the customer invoice is credited at
-- the gross charge. Preserve both values on the append-only allocation row.

drop trigger if exists protect_customer_revenue_allocation
  on public.customer_invoice_bank_allocations;

-- The one-time backfill would otherwise queue the existing audit and deferred
-- total-check triggers, which prevents the following ALTER COLUMN in the same
-- transaction. No business row is changed while these triggers are disabled.
alter table public.customer_invoice_bank_allocations disable trigger user;

alter table public.customer_invoice_bank_allocations
  add column if not exists invoice_applied_amount numeric(14,2);

update public.customer_invoice_bank_allocations
set invoice_applied_amount = allocated_amount
where invoice_applied_amount is null;

alter table public.customer_invoice_bank_allocations
  alter column invoice_applied_amount set not null;

alter table public.customer_invoice_bank_allocations enable trigger user;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.customer_invoice_bank_allocations'::regclass
      and conname = 'customer_invoice_bank_allocations_invoice_amount_positive'
  ) then
    alter table public.customer_invoice_bank_allocations
      add constraint customer_invoice_bank_allocations_invoice_amount_positive
      check (invoice_applied_amount > 0);
  end if;
end $$;

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
  new.invoice_applied_amount := coalesce(
    new.invoice_applied_amount,
    new.allocated_amount
  );

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
     or new.invoice_applied_amount <> old.invoice_applied_amount
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

create trigger protect_customer_revenue_allocation
before update on public.customer_invoice_bank_allocations
for each row execute function public.protect_customer_revenue_allocation();

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
  select coalesce(sum(invoice_applied_amount), 0) into active_total
  from public.customer_invoice_bank_allocations
  where customer_invoice_id = invoice_id and reversed_at is null;
  if active_total > invoice_amount + 0.005 then
    raise exception 'Active invoice credits exceed customer invoice total';
  end if;

  if payment_id is not null then
    select amount into payment_amount
    from public.customer_invoice_payment_events where id = payment_id;
    select coalesce(sum(invoice_applied_amount), 0) into active_total
    from public.customer_invoice_bank_allocations
    where source_payment_event_id = payment_id and reversed_at is null;
    if active_total > payment_amount + 0.005 then
      raise exception 'Active invoice credits exceed source payment-event amount';
    end if;
  end if;

  return null;
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
  select coalesce(sum(invoice_applied_amount), 0) into active_total
  from public.customer_invoice_bank_allocations
  where customer_invoice_id = new.id and reversed_at is null;
  if active_total > new.total_amount + 0.005 then
    raise exception 'Updated invoice total is below its active invoice credits';
  end if;
  return new;
end;
$$;

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
  coalesce(bank.invoice_paid_amount, 0)::numeric(14,2) as bank_paid_amount,
  (invoice.total_amount - coalesce(bank.invoice_paid_amount, 0))::numeric(14,2) as amount_remaining,
  case
    when coalesce(bank.invoice_paid_amount, 0) >= invoice.total_amount - 0.005 then 'paid'
    when coalesce(bank.invoice_paid_amount, 0) > 0 then 'partially_paid'
    else 'unpaid'
  end as bank_payment_status,
  case
    when coalesce(documents.document_count, 0) = 0 then 'needs_information'
    when abs(coalesce(items.item_total, 0) - invoice.total_amount) > 0.02 then 'needs_review'
    when coalesce(bank.invoice_paid_amount, 0) + 0.005 < invoice.source_paid_amount then 'needs_review'
    else 'verified'
  end as verification_status,
  coalesce(bank.bank_cash_amount, 0)::numeric(14,2) as bank_cash_amount,
  coalesce(bank.processing_fee_amount, 0)::numeric(14,2) as processing_fee_amount
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
  select
    count(*) as bank_payment_count,
    sum(allocation.allocated_amount) as bank_cash_amount,
    sum(allocation.invoice_applied_amount) as invoice_paid_amount,
    sum(allocation.invoice_applied_amount - allocation.allocated_amount) as processing_fee_amount
  from public.customer_invoice_bank_allocations allocation
  where allocation.customer_invoice_id = invoice.id
    and allocation.reversed_at is null
) bank on true;

comment on column public.customer_invoice_bank_allocations.allocated_amount is
  'Cash from this bank transaction allocated to the invoice.';
comment on column public.customer_invoice_bank_allocations.invoice_applied_amount is
  'Gross amount credited to the invoice; differs from cash when processor fees are withheld.';
