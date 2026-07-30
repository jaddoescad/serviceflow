-- Require every allocated cent to fit inside its source payment/payable.

begin;

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
      from public.labour_bonus_payment_allocations allocation
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
        coalesce(invoice.amount_before_tax, 0)
          + coalesce(invoice.tax_amount, 0)
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
  elsif target_bonus_id is not null then
    select bonus.amount, bonus.currency, bonus.contractor_id
    into target_amount, target_currency, target_contractor_id
    from public.labour_bonus_payables bonus
    where bonus.id = target_bonus_id
      and bonus.status = 'approved';

    if target_amount is null then
      raise exception 'Bonus must exist and be approved';
    end if;

    select coalesce(sum(allocation.allocated_amount), 0)
    into allocated_total
    from public.labour_bonus_payment_allocations allocation
    where allocation.bonus_payable_id = target_bonus_id
      and allocation.reversed_at is null;

    if allocated_total > target_amount then
      raise exception
        'Bonus payments % exceed approved bonus %',
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

  select
    count(distinct contractor_id),
    max(contractor_id::text)::uuid
  into contractor_count, allocation_contractor_id
  from (
    select invoice.contractor_id
    from public.labour_payment_allocations allocation
    join public.labour_invoices invoice
      on invoice.id = allocation.invoice_id
    where allocation.financial_transaction_id = target_transaction_id
      and allocation.reversed_at is null
    union all
    select bonus.contractor_id
    from public.labour_bonus_payment_allocations allocation
    join public.labour_bonus_payables bonus
      on bonus.id = allocation.bonus_payable_id
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

create or replace function public.assert_labour_invoice_line_job_total(
  target_line_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  line_amount numeric;
  allocation_total numeric;
  bad_sign_count integer;
begin
  select line.amount_before_tax
  into line_amount
  from public.labour_invoice_lines line
  where line.id = target_line_id;

  if line_amount is null then
    return;
  end if;

  select
    coalesce(sum(allocation.allocated_amount), 0),
    count(*) filter (
      where
        (line_amount >= 0 and allocation.allocated_amount < 0)
        or (line_amount < 0 and allocation.allocated_amount > 0)
    )
  into allocation_total, bad_sign_count
  from public.labour_invoice_line_allocations allocation
  where allocation.invoice_line_id = target_line_id;

  if bad_sign_count > 0 then
    raise exception 'Job allocation signs must match the invoice line';
  end if;

  if (line_amount >= 0 and allocation_total > line_amount)
    or (line_amount < 0 and allocation_total < line_amount) then
    raise exception
      'Job allocations % exceed invoice line amount %',
      allocation_total,
      line_amount;
  end if;
end;
$$;

commit;
