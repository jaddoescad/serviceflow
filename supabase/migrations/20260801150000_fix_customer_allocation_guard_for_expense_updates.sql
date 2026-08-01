create or replace function public.validate_customer_transaction_existing_allocations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_total numeric;
begin
  select coalesce(sum(allocated_amount), 0)
  into active_total
  from public.customer_invoice_bank_allocations
  where financial_transaction_id = new.id
    and reversed_at is null;

  if active_total > 0 and (
    new.amount <= 0
    or new.transaction_type <> 'income'
    or new.is_transfer
    or new.category <> 'Painting revenue'
  ) then
    raise exception 'A transaction with active customer allocations must remain Painting revenue income';
  end if;

  if active_total > 0 and active_total > new.amount + 0.005 then
    raise exception 'Updated bank amount is below its active customer allocations';
  end if;

  return new;
end;
$$;

comment on function public.validate_customer_transaction_existing_allocations()
is 'Protects transactions with active customer allocations while permitting unrelated expense and transfer metadata updates.';
