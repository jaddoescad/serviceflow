begin;

create table if not exists public.material_credit_allocations (
  id uuid primary key default gen_random_uuid(),
  credit_material_invoice_id uuid not null
    references public.material_invoices(id) on delete restrict,
  charge_material_invoice_id uuid not null
    references public.material_invoices(id) on delete restrict,
  allocated_amount numeric(14, 2) not null,
  allocation_method text not null,
  evidence_reference text,
  source_payload jsonb not null default '{}'::jsonb,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text,
  inserted_at timestamptz not null default now(),
  inserted_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint material_credit_allocations_distinct_invoice_check
    check (credit_material_invoice_id <> charge_material_invoice_id),
  constraint material_credit_allocations_amount_positive
    check (allocated_amount > 0),
  constraint material_credit_allocations_method_check
    check (allocation_method in ('statement_fifo', 'manual')),
  constraint material_credit_allocations_reversal_check
    check (
      (reversed_at is null and reversed_by is null and reversal_reason is null)
      or
      (reversed_at is not null and reversal_reason is not null)
    )
);

create index if not exists material_credit_allocations_credit_idx
  on public.material_credit_allocations(credit_material_invoice_id)
  where reversed_at is null;
create index if not exists material_credit_allocations_charge_idx
  on public.material_credit_allocations(charge_material_invoice_id)
  where reversed_at is null;
create unique index if not exists material_credit_allocations_active_unique
  on public.material_credit_allocations(credit_material_invoice_id, charge_material_invoice_id)
  where reversed_at is null;

create or replace function public.validate_material_credit_allocation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  credit_row public.material_invoices%rowtype;
  charge_row public.material_invoices%rowtype;
  active_credit_total numeric(14, 2);
  active_charge_credit_total numeric(14, 2);
  active_charge_payment_total numeric(14, 2);
begin
  if new.reversed_at is not null then return new; end if;

  select * into credit_row
  from public.material_invoices
  where id = new.credit_material_invoice_id;
  select * into charge_row
  from public.material_invoices
  where id = new.charge_material_invoice_id;

  if credit_row.id is null or credit_row.total_amount >= 0 then
    raise exception 'Material credit allocations require a negative source invoice';
  end if;
  if charge_row.id is null or charge_row.total_amount <= 0 then
    raise exception 'Material credit allocations require a positive target invoice';
  end if;
  if credit_row.invoice_date < charge_row.invoice_date then
    raise exception 'A supplier credit may only reduce an existing charge invoice';
  end if;

  select coalesce(sum(allocated_amount), 0)
  into active_credit_total
  from public.material_credit_allocations
  where credit_material_invoice_id = new.credit_material_invoice_id
    and reversed_at is null
    and id is distinct from new.id;

  select coalesce(sum(allocated_amount), 0)
  into active_charge_credit_total
  from public.material_credit_allocations
  where charge_material_invoice_id = new.charge_material_invoice_id
    and reversed_at is null
    and id is distinct from new.id;

  select coalesce(sum(allocated_amount), 0)
  into active_charge_payment_total
  from public.material_payment_allocations
  where material_invoice_id = new.charge_material_invoice_id
    and reversed_at is null;

  if active_credit_total + new.allocated_amount > abs(credit_row.total_amount) + 0.02 then
    raise exception 'Material credit allocations exceed the credit memo total';
  end if;
  if active_charge_credit_total + active_charge_payment_total + new.allocated_amount
    > charge_row.total_amount + 0.02 then
    raise exception 'Material settlements exceed the charge invoice total';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_material_credit_allocation
  on public.material_credit_allocations;
create trigger validate_material_credit_allocation
before insert or update on public.material_credit_allocations
for each row execute function public.validate_material_credit_allocation();

drop trigger if exists protect_material_credit_allocation_history
  on public.material_credit_allocations;
create trigger protect_material_credit_allocation_history
before update on public.material_credit_allocations
for each row execute function public.protect_material_allocation_history();

drop trigger if exists material_credit_allocations_set_updated_at
  on public.material_credit_allocations;
create trigger material_credit_allocations_set_updated_at
before update on public.material_credit_allocations
for each row execute function public.set_updated_at();

create or replace function public.validate_material_payment_allocation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  transaction_row public.financial_transactions%rowtype;
  invoice_row public.material_invoices%rowtype;
  active_transaction_total numeric(14, 2);
  active_invoice_total numeric(14, 2);
  active_invoice_credit_total numeric(14, 2);
begin
  if new.reversed_at is not null then return new; end if;

  select * into transaction_row
  from public.financial_transactions
  where id = new.financial_transaction_id;
  if transaction_row.id is null
    or transaction_row.transaction_type <> 'expense'
    or transaction_row.is_transfer
    or transaction_row.amount >= 0 then
    raise exception 'Material allocations require a posted expense transaction';
  end if;

  select * into invoice_row
  from public.material_invoices
  where id = new.material_invoice_id;
  if invoice_row.id is null or invoice_row.total_amount <= 0 then
    raise exception 'Bank payments may only settle positive material invoices';
  end if;

  select coalesce(sum(allocated_amount), 0)
  into active_transaction_total
  from public.material_payment_allocations
  where financial_transaction_id = new.financial_transaction_id
    and reversed_at is null
    and id is distinct from new.id;

  select coalesce(sum(allocated_amount), 0)
  into active_invoice_total
  from public.material_payment_allocations
  where material_invoice_id = new.material_invoice_id
    and reversed_at is null
    and id is distinct from new.id;

  select coalesce(sum(allocated_amount), 0)
  into active_invoice_credit_total
  from public.material_credit_allocations
  where charge_material_invoice_id = new.material_invoice_id
    and reversed_at is null;

  if active_transaction_total + new.allocated_amount > abs(transaction_row.amount) + 0.02 then
    raise exception 'Material allocations exceed the bank transaction total';
  end if;
  if active_invoice_total + active_invoice_credit_total + new.allocated_amount
    > invoice_row.total_amount + 0.02 then
    raise exception 'Material settlements exceed the invoice total';
  end if;
  return new;
end;
$$;

drop view if exists public.material_invoice_verification;
create view public.material_invoice_verification
with (security_invoker = true)
as
with line_totals as (
  select
    line.material_invoice_id,
    count(*)::integer as line_count,
    sum(line.amount_before_tax)::numeric(14, 2) as line_amount_before_tax,
    sum(line.tax_amount)::numeric(14, 2) as line_tax_amount,
    sum(line.total_amount)::numeric(14, 2) as line_total_amount,
    bool_or(line.needs_review) as line_needs_review
  from public.material_invoice_lines line
  group by line.material_invoice_id
), job_totals as (
  select
    line.material_invoice_id,
    count(allocation.id)::integer as allocation_count,
    count(distinct allocation.companycam_project_id)
      filter (where allocation.companycam_project_id is not null)::integer as job_count,
    sum(allocation.allocated_before_tax)::numeric(14, 2) as allocated_before_tax,
    sum(allocation.allocated_tax)::numeric(14, 2) as allocated_tax,
    sum(allocation.allocated_total)::numeric(14, 2) as allocated_total,
    bool_or(allocation.needs_review) as allocation_needs_review
  from public.material_invoice_lines line
  join public.material_invoice_line_allocations allocation
    on allocation.material_invoice_line_id = line.id
   and allocation.reversed_at is null
  group by line.material_invoice_id
), payment_totals as (
  select
    allocation.material_invoice_id,
    count(*)::integer as payment_count,
    sum(allocation.allocated_amount)::numeric(14, 2) as paid_amount,
    bool_or(allocation.needs_review) as payment_needs_review
  from public.material_payment_allocations allocation
  where allocation.reversed_at is null
  group by allocation.material_invoice_id
), credit_targets as (
  select
    allocation.charge_material_invoice_id as material_invoice_id,
    sum(allocation.allocated_amount)::numeric(14, 2) as credit_applied_amount
  from public.material_credit_allocations allocation
  where allocation.reversed_at is null
  group by allocation.charge_material_invoice_id
), credit_sources as (
  select
    allocation.credit_material_invoice_id as material_invoice_id,
    sum(allocation.allocated_amount)::numeric(14, 2) as credit_used_amount
  from public.material_credit_allocations allocation
  where allocation.reversed_at is null
  group by allocation.credit_material_invoice_id
)
select
  invoice.id as material_invoice_id,
  invoice.document_id,
  invoice.supplier_name,
  invoice.invoice_number,
  invoice.invoice_type,
  invoice.invoice_date,
  invoice.po_number,
  invoice.currency,
  invoice.amount_before_tax,
  invoice.tax_amount,
  invoice.total_amount,
  invoice.extraction_status,
  coalesce(lines.line_count, 0) as line_count,
  coalesce(lines.line_amount_before_tax, 0)::numeric(14, 2) as line_amount_before_tax,
  coalesce(lines.line_tax_amount, 0)::numeric(14, 2) as line_tax_amount,
  coalesce(lines.line_total_amount, 0)::numeric(14, 2) as line_total_amount,
  coalesce(jobs.allocation_count, 0) as allocation_count,
  coalesce(jobs.job_count, 0) as job_count,
  coalesce(jobs.allocated_before_tax, 0)::numeric(14, 2) as job_allocated_before_tax,
  coalesce(jobs.allocated_tax, 0)::numeric(14, 2) as job_allocated_tax,
  coalesce(jobs.allocated_total, 0)::numeric(14, 2) as job_allocated_total,
  coalesce(payments.payment_count, 0) as payment_count,
  coalesce(payments.paid_amount, 0)::numeric(14, 2) as paid_amount,
  coalesce(credits_in.credit_applied_amount, 0)::numeric(14, 2) as credit_applied_amount,
  coalesce(credits_out.credit_used_amount, 0)::numeric(14, 2) as credit_used_amount,
  case
    when invoice.total_amount < 0 then
      (abs(invoice.total_amount) - coalesce(credits_out.credit_used_amount, 0))::numeric(14, 2)
    else
      (invoice.total_amount - coalesce(payments.paid_amount, 0) - coalesce(credits_in.credit_applied_amount, 0))::numeric(14, 2)
  end as amount_remaining,
  case
    when invoice.extraction_status in ('needs_extraction', 'needs_review') then 'needs_review'
    when coalesce(lines.line_count, 0) = 0 then 'needs_review'
    when abs(coalesce(lines.line_amount_before_tax, 0) - invoice.amount_before_tax) > 0.02 then 'needs_review'
    when abs(coalesce(lines.line_tax_amount, 0) - invoice.tax_amount) > 0.02 then 'needs_review'
    when coalesce(lines.line_needs_review, false) then 'needs_review'
    when abs(coalesce(jobs.allocated_total, 0) - invoice.total_amount) > 0.02 then 'needs_review'
    when coalesce(jobs.allocation_needs_review, false) then 'needs_review'
    when coalesce(payments.payment_needs_review, false) then 'needs_review'
    when invoice.total_amount < 0
      and coalesce(credits_out.credit_used_amount, 0) < abs(invoice.total_amount) - 0.02 then 'unapplied_credit'
    when invoice.total_amount > 0
      and coalesce(payments.paid_amount, 0) + coalesce(credits_in.credit_applied_amount, 0)
        < invoice.total_amount - 0.02 then 'unpaid'
    else 'verified'
  end as verification_status
from public.material_invoices invoice
left join line_totals lines on lines.material_invoice_id = invoice.id
left join job_totals jobs on jobs.material_invoice_id = invoice.id
left join payment_totals payments on payments.material_invoice_id = invoice.id
left join credit_targets credits_in on credits_in.material_invoice_id = invoice.id
left join credit_sources credits_out on credits_out.material_invoice_id = invoice.id;

alter table public.material_credit_allocations enable row level security;
drop policy if exists "Managers can read material_credit_allocations"
  on public.material_credit_allocations;
create policy "Managers can read material_credit_allocations"
  on public.material_credit_allocations for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));
drop policy if exists "Managers can insert material_credit_allocations"
  on public.material_credit_allocations;
create policy "Managers can insert material_credit_allocations"
  on public.material_credit_allocations for insert to authenticated
  with check (public.current_employee_role() in ('admin', 'manager'));
drop policy if exists "Managers can update material_credit_allocations"
  on public.material_credit_allocations;
create policy "Managers can update material_credit_allocations"
  on public.material_credit_allocations for update to authenticated
  using (public.current_employee_role() in ('admin', 'manager'))
  with check (public.current_employee_role() in ('admin', 'manager'));

grant select, insert, update on public.material_credit_allocations to authenticated;
grant select on public.material_invoice_verification to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
