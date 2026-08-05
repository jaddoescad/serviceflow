begin;

do $$
begin
  if exists (select 1 from public.labour_bonus_payment_allocations)
    or exists (select 1 from public.labour_bonus_payables)
    or exists (select 1 from public.labour_reconciliation_resolutions) then
    raise exception 'Unused labour bonus/reconciliation tables are no longer empty';
  end if;
end
$$;

create or replace view public.labour_payment_verification
with (security_invoker = true)
as
with invoice_allocations as (
  select
    allocation.financial_transaction_id,
    sum(allocation.allocated_amount)::numeric(14, 2) as invoice_amount,
    count(*)::integer as invoice_count
  from public.labour_payment_allocations allocation
  where allocation.reversed_at is null
  group by allocation.financial_transaction_id
),
other_allocations as (
  select
    allocation.financial_transaction_id,
    sum(allocation.allocated_amount)::numeric(14, 2) as other_amount,
    count(*)::integer as other_count
  from public.labour_payment_other_allocations allocation
  where allocation.reversed_at is null
  group by allocation.financial_transaction_id
)
select
  transaction.id as financial_transaction_id,
  record.contractor_id,
  coalesce(record.recipient_status, 'unknown') as recipient_status,
  abs(transaction.amount)::numeric(14, 2) as payment_amount,
  coalesce(invoices.invoice_amount, 0)::numeric(14, 2)
    as invoice_allocated_amount,
  0::numeric(14, 2) as bonus_allocated_amount,
  coalesce(other.other_amount, 0)::numeric(14, 2)
    as other_allocated_amount,
  (
    coalesce(invoices.invoice_amount, 0)
    + coalesce(other.other_amount, 0)
  )::numeric(14, 2) as total_allocated_amount,
  (
    abs(transaction.amount)
    - coalesce(invoices.invoice_amount, 0)
    - coalesce(other.other_amount, 0)
  )::numeric(14, 2) as unallocated_amount,
  coalesce(invoices.invoice_count, 0) as invoice_count,
  0::integer as bonus_count,
  coalesce(other.other_count, 0) as other_count,
  case
    when coalesce(record.recipient_status, 'unknown') = 'unknown'
      then 'unidentified'
    when coalesce(invoices.invoice_count, 0) + coalesce(other.other_count, 0) = 0
      then 'unmatched'
    when coalesce(invoices.invoice_amount, 0) + coalesce(other.other_amount, 0)
      > abs(transaction.amount) + 0.01
      then 'needs_review'
    when coalesce(invoices.invoice_amount, 0) + coalesce(other.other_amount, 0)
      < abs(transaction.amount) - 0.01
      then 'partially_allocated'
    else 'fully_allocated'
  end as payment_status
from public.financial_transactions transaction
left join public.labour_payment_records record
  on record.financial_transaction_id = transaction.id
left join invoice_allocations invoices
  on invoices.financial_transaction_id = transaction.id
left join other_allocations other
  on other.financial_transaction_id = transaction.id
where transaction.transaction_type = 'expense'
  and not transaction.is_transfer
  and transaction.amount < 0
  and (
    transaction.category = 'Subcontractors'
    or record.financial_transaction_id is not null
  );

create or replace view public.labour_payment_reconciliation
with (security_invoker = true)
as
with allocation_totals as (
  select
    allocation.financial_transaction_id,
    count(*)::integer as invoice_count,
    count(distinct invoice.contractor_id)::integer as contractor_count,
    sum(allocation.allocated_amount)::numeric(14, 2) as allocated_amount
  from public.labour_payment_allocations allocation
  join public.labour_invoices invoice on invoice.id = allocation.invoice_id
  group by allocation.financial_transaction_id
)
select
  transaction.id as financial_transaction_id,
  transaction.posted_on,
  transaction.counterparty,
  transaction.description,
  transaction.currency,
  abs(transaction.amount)::numeric(14, 2) as payment_amount,
  coalesce(totals.allocated_amount, 0)::numeric(14, 2) as allocated_amount,
  (
    abs(transaction.amount) - coalesce(totals.allocated_amount, 0)
  )::numeric(14, 2) as unallocated_amount,
  coalesce(totals.invoice_count, 0) as invoice_count,
  coalesce(totals.contractor_count, 0) as contractor_count,
  case
    when coalesce(totals.invoice_count, 0) = 0 then 'needs_review'
    when coalesce(totals.contractor_count, 0) <> 1 then 'mismatch'
    when coalesce(totals.allocated_amount, 0) > abs(transaction.amount) + 0.01
      then 'mismatch'
    when coalesce(totals.allocated_amount, 0) < abs(transaction.amount) - 0.01
      then 'partial'
    else 'settled'
  end as settlement_status
from public.financial_transactions transaction
left join allocation_totals totals
  on totals.financial_transaction_id = transaction.id
where transaction.transaction_type = 'expense'
  and not transaction.is_transfer
  and transaction.category = 'Subcontractors'
  and transaction.amount < 0;

create or replace view public.labour_invoice_reconciliation
with (security_invoker = true)
as
with line_totals as (
  select
    line.invoice_id,
    count(*)::integer as line_count,
    sum(line.amount_before_tax)::numeric(14, 2) as line_amount,
    sum(line.quantity_hours)::numeric(12, 4) as invoiced_hours,
    count(*) filter (where line.quantity_hours is not null)::integer
      as lines_with_hours,
    bool_or(line.needs_review) as lines_need_review
  from public.labour_invoice_lines line
  group by line.invoice_id
),
job_totals as (
  select
    line.invoice_id,
    count(allocation.companycam_project_id)::integer as project_allocation_count,
    sum(allocation.allocated_amount)::numeric(14, 2) as job_allocated_amount,
    bool_or(allocation.needs_review) as jobs_need_review
  from public.labour_invoice_lines line
  join public.labour_invoice_line_allocations allocation
    on allocation.invoice_line_id = line.id
  group by line.invoice_id
),
time_totals as (
  select
    line.invoice_id,
    count(link.time_entry_id)::integer as time_entry_count,
    sum(link.allocated_hours)::numeric(12, 4) as linked_time_hours,
    bool_or(link.needs_review) as time_needs_review
  from public.labour_invoice_lines line
  join public.labour_invoice_line_time_entries link
    on link.invoice_line_id = line.id
  group by line.invoice_id
),
payment_totals as (
  select
    allocation.invoice_id,
    count(*)::integer as payment_count,
    sum(allocation.allocated_amount)::numeric(14, 2) as paid_amount
  from public.labour_payment_allocations allocation
  group by allocation.invoice_id
)
select
  invoice.id as invoice_id,
  invoice.contractor_id,
  invoice.supplier_name,
  invoice.invoice_number,
  invoice.invoice_date,
  invoice.currency,
  coalesce(
    invoice.amount_paid,
    coalesce(invoice.amount_before_tax, 0) + coalesce(invoice.tax_amount, 0)
  )::numeric(14, 2) as amount_due,
  coalesce(invoice.amount_before_tax, 0)::numeric(14, 2)
    as invoice_before_tax,
  coalesce(lines.line_count, 0) as line_count,
  coalesce(lines.line_amount, 0)::numeric(14, 2) as line_amount,
  (
    coalesce(lines.line_amount, 0) - coalesce(invoice.amount_before_tax, 0)
  )::numeric(14, 2) as invoice_line_variance,
  coalesce(jobs.project_allocation_count, 0) as project_allocation_count,
  coalesce(jobs.job_allocated_amount, 0)::numeric(14, 2)
    as job_allocated_amount,
  (
    coalesce(jobs.job_allocated_amount, 0) - coalesce(lines.line_amount, 0)
  )::numeric(14, 2) as job_allocation_variance,
  coalesce(payments.payment_count, 0) as payment_count,
  coalesce(payments.paid_amount, 0)::numeric(14, 2) as paid_amount,
  (
    coalesce(payments.paid_amount, 0)
    - coalesce(
      invoice.amount_paid,
      coalesce(invoice.amount_before_tax, 0) + coalesce(invoice.tax_amount, 0)
    )
  )::numeric(14, 2) as payment_variance,
  coalesce(lines.invoiced_hours, 0)::numeric(12, 4) as invoiced_hours,
  coalesce(times.linked_time_hours, 0)::numeric(12, 4) as linked_time_hours,
  (
    coalesce(times.linked_time_hours, 0) - coalesce(lines.invoiced_hours, 0)
  )::numeric(12, 4) as hours_variance,
  case
    when invoice.contractor_id is null or coalesce(lines.line_count, 0) = 0
      then 'needs_review'
    when coalesce(jobs.project_allocation_count, 0) = 0
      or coalesce(payments.payment_count, 0) = 0
      then 'partial'
    when abs(
      coalesce(lines.line_amount, 0) - coalesce(invoice.amount_before_tax, 0)
    ) > 0.01
      then 'mismatch'
    when abs(
      coalesce(jobs.job_allocated_amount, 0) - coalesce(lines.line_amount, 0)
    ) > 0.01
      then 'mismatch'
    when abs(
      coalesce(payments.paid_amount, 0)
      - coalesce(
        invoice.amount_paid,
        coalesce(invoice.amount_before_tax, 0) + coalesce(invoice.tax_amount, 0)
      )
    ) > 0.01
      then 'mismatch'
    when coalesce(lines.lines_with_hours, 0) > 0
      and abs(
        coalesce(times.linked_time_hours, 0)
        - coalesce(lines.invoiced_hours, 0)
      ) > 0.0167
      then 'mismatch'
    when coalesce(lines.lines_need_review, false)
      or coalesce(jobs.jobs_need_review, false)
      or coalesce(times.time_needs_review, false)
      then 'needs_review'
    else 'settled'
  end as settlement_status
from public.labour_invoices invoice
left join line_totals lines on lines.invoice_id = invoice.id
left join job_totals jobs on jobs.invoice_id = invoice.id
left join time_totals times on times.invoice_id = invoice.id
left join payment_totals payments on payments.invoice_id = invoice.id
where invoice.document_type = 'invoice';

create or replace function public.assert_labour_payment_allocation(
  target_transaction_id uuid,
  target_invoice_id uuid default null,
  target_bonus_id uuid default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  payment_amount numeric;
  payment_currency text;
  allocated_total numeric;
  target_amount numeric;
  target_currency text;
  target_contractor_id uuid;
  payment_contractor_id uuid;
  allocation_contractor_id uuid;
  contractor_count integer;
begin
  if target_bonus_id is not null then
    raise exception 'Labour bonus payable allocations are no longer supported';
  end if;

  select abs(transaction.amount), transaction.currency
  into payment_amount, payment_currency
  from public.financial_transactions transaction
  where transaction.id = target_transaction_id
    and transaction.transaction_type = 'expense'
    and not transaction.is_transfer
    and transaction.amount < 0;

  if payment_amount is null then
    raise exception
      'Labour allocation requires a negative non-transfer bank expense';
  end if;

  select
    coalesce((
      select sum(allocation.allocated_amount)
      from public.labour_payment_allocations allocation
      where allocation.financial_transaction_id = target_transaction_id
        and allocation.reversed_at is null
    ), 0)
    + coalesce((
      select sum(allocation.allocated_amount)
      from public.labour_payment_other_allocations allocation
      where allocation.financial_transaction_id = target_transaction_id
        and allocation.reversed_at is null
    ), 0)
  into allocated_total;

  if allocated_total > payment_amount then
    raise exception
      'Payment allocations % exceed bank payment %',
      allocated_total,
      payment_amount;
  end if;

  if target_invoice_id is not null then
    select
      coalesce(
        invoice.amount_paid,
        coalesce(invoice.amount_before_tax, 0) + coalesce(invoice.tax_amount, 0)
      ),
      invoice.currency,
      invoice.contractor_id
    into target_amount, target_currency, target_contractor_id
    from public.labour_invoices invoice
    where invoice.id = target_invoice_id
      and invoice.document_type = 'invoice';

    if target_amount is null or target_contractor_id is null then
      raise exception 'Invoice must have an amount and contractor';
    end if;

    select coalesce(sum(allocation.allocated_amount), 0)
    into allocated_total
    from public.labour_payment_allocations allocation
    where allocation.invoice_id = target_invoice_id
      and allocation.reversed_at is null;

    if allocated_total > target_amount then
      raise exception
        'Invoice payments % exceed invoice amount %; classify the excess separately',
        allocated_total,
        target_amount;
    end if;
  end if;

  if target_currency is not null and payment_currency <> target_currency then
    raise exception 'Payment and payable currencies must match';
  end if;

  select record.contractor_id
  into payment_contractor_id
  from public.labour_payment_records record
  where record.financial_transaction_id = target_transaction_id
    and record.recipient_status = 'confirmed';

  if payment_contractor_id is not null
    and target_contractor_id is not null
    and payment_contractor_id <> target_contractor_id then
    raise exception 'Payment recipient and payable contractor do not match';
  end if;

  select count(distinct contractor_id), max(contractor_id::text)::uuid
  into contractor_count, allocation_contractor_id
  from (
    select invoice.contractor_id
    from public.labour_payment_allocations allocation
    join public.labour_invoices invoice on invoice.id = allocation.invoice_id
    where allocation.financial_transaction_id = target_transaction_id
      and allocation.reversed_at is null
    union all
    select allocation.contractor_id
    from public.labour_payment_other_allocations allocation
    where allocation.financial_transaction_id = target_transaction_id
      and allocation.reversed_at is null
  ) contractors;

  if contractor_count > 1 then
    raise exception
      'A subcontractor payment cannot be allocated across different contractors';
  end if;

  if payment_contractor_id is not null
    and allocation_contractor_id is not null
    and payment_contractor_id <> allocation_contractor_id then
    raise exception 'Payment recipient and allocated contractor do not match';
  end if;
end;
$$;

create or replace function public.validate_payment_existing_allocations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.labour_payment_records record
    where record.financial_transaction_id = new.id
    union all
    select 1
    from public.labour_payment_allocations allocation
    where allocation.financial_transaction_id = new.id
      and allocation.reversed_at is null
    union all
    select 1
    from public.labour_payment_other_allocations allocation
    where allocation.financial_transaction_id = new.id
      and allocation.reversed_at is null
  ) then
    perform public.assert_labour_payment_allocation(new.id, null, null);
  end if;
  return new;
end;
$$;

create or replace function public.log_labour_verification_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_json jsonb;
  new_json jsonb;
  event_action text;
  record_id text;
  event_type text;
begin
  old_json := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_json := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  event_action := lower(tg_op);

  if tg_op = 'UPDATE'
    and old_json ->> 'reversed_at' is null
    and new_json ->> 'reversed_at' is not null then
    event_action := 'reverse';
  end if;

  record_id := coalesce(
    new_json ->> 'id',
    old_json ->> 'id',
    new_json ->> 'financial_transaction_id',
    old_json ->> 'financial_transaction_id',
    new_json ->> 'invoice_line_id',
    old_json ->> 'invoice_line_id'
  );

  event_type := case tg_table_name
    when 'labour_contractors' then 'contractor'
    when 'labour_invoice_lines' then 'invoice_line'
    when 'labour_invoice_line_allocations' then 'job_allocation'
    when 'labour_invoice_line_time_entries' then 'time_allocation'
    when 'labour_payment_records' then 'payment'
    when 'labour_payment_allocations' then 'invoice_payment'
    when 'labour_payment_other_allocations' then 'other_payment'
    else 'invoice'
  end;

  insert into public.labour_verification_events (
    entity_type,
    entity_id,
    action,
    old_values,
    new_values,
    reason,
    performed_by
  )
  values (
    event_type,
    record_id,
    event_action,
    old_json,
    new_json,
    coalesce(
      new_json ->> 'reversal_reason',
      new_json ->> 'explanation',
      new_json ->> 'confirmation_note'
    ),
    auth.uid()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.log_labour_verification_event()
  from public, anon, authenticated;

drop table public.labour_bonus_payment_allocations;
drop table public.labour_bonus_payables;
drop table public.labour_reconciliation_resolutions;
drop function public.protect_approved_labour_bonus();

comment on view public.labour_payment_verification is
  'Labour payment verification across invoice and documented other allocations.';
comment on function public.assert_labour_payment_allocation(uuid, uuid, uuid) is
  'Validates invoice and documented other allocations against a bank payment.';

select pg_notify('pgrst', 'reload schema');

commit;
