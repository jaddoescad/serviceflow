-- Forward-only hardening for subcontractor invoice/payment verification.
-- Applied after 20260730172500_create_labour_settlement_model.sql.

begin;

alter table public.labour_payment_allocations
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid
    references auth.users(id) on delete restrict,
  add column if not exists reversal_reason text;

alter table public.labour_payment_allocations
  drop constraint if exists
    labour_payment_allocations_financial_transaction_id_invoice_id_key;

create unique index if not exists labour_payment_allocations_active_key
  on public.labour_payment_allocations(financial_transaction_id, invoice_id)
  where reversed_at is null;

create table if not exists public.labour_payment_records (
  financial_transaction_id uuid primary key
    references public.financial_transactions(id)
    on update cascade on delete restrict,
  contractor_id uuid
    references public.labour_contractors(id)
    on update cascade on delete restrict,
  recipient_status text not null default 'unknown'
    check (recipient_status in ('unknown', 'confirmed')),
  confirmation_method text
    check (
      confirmation_method is null
      or confirmation_method in (
        'bank_record',
        'payment_confirmation',
        'manual_confirmation'
      )
    ),
  confirmation_note text,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  inserted_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (
    (recipient_status = 'unknown'
      and contractor_id is null
      and confirmed_at is null)
    or
    (recipient_status = 'confirmed'
      and contractor_id is not null
      and confirmation_method is not null
      and confirmed_at is not null)
  ),
  check (
    confirmation_method <> 'manual_confirmation'
    or length(trim(coalesce(confirmation_note, ''))) >= 8
  )
);

create index if not exists labour_payment_records_contractor_idx
  on public.labour_payment_records(contractor_id, financial_transaction_id)
  where contractor_id is not null;

create table if not exists public.labour_bonus_payables (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null
    references public.labour_contractors(id)
    on update cascade on delete restrict,
  companycam_project_id text not null
    references public.companycam_projects(companycam_id)
    on update cascade on delete restrict,
  worker_user_id uuid
    references public.employee_profiles(user_id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'CAD'
    check (currency ~ '^[A-Z]{3}$'),
  formula_version text not null
    check (length(trim(formula_version)) > 0),
  calculation_inputs jsonb not null
    check (jsonb_typeof(calculation_inputs) = 'object'),
  calculation_note text,
  status text not null default 'approved'
    check (status in ('approved', 'reversed')),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default timezone('utc', now()),
  reversed_by uuid references auth.users(id) on delete restrict,
  reversed_at timestamptz,
  reversal_reason text,
  supersedes_bonus_id uuid
    references public.labour_bonus_payables(id) on delete restrict,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (
    (status = 'approved'
      and reversed_by is null
      and reversed_at is null
      and reversal_reason is null)
    or
    (status = 'reversed'
      and reversed_by is not null
      and reversed_at is not null
      and length(trim(coalesce(reversal_reason, ''))) >= 8)
  )
);

create index if not exists labour_bonus_payables_contractor_idx
  on public.labour_bonus_payables(contractor_id, approved_at desc);

create index if not exists labour_bonus_payables_project_idx
  on public.labour_bonus_payables(companycam_project_id, approved_at desc);

create table if not exists public.labour_bonus_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  financial_transaction_id uuid not null
    references public.financial_transactions(id)
    on update cascade on delete restrict,
  bonus_payable_id uuid not null
    references public.labour_bonus_payables(id)
    on update cascade on delete restrict,
  allocated_amount numeric(12, 2) not null check (allocated_amount > 0),
  notes text,
  inserted_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  reversed_by uuid references auth.users(id) on delete restrict,
  reversed_at timestamptz,
  reversal_reason text,
  check (
    (reversed_at is null
      and reversed_by is null
      and reversal_reason is null)
    or
    (reversed_at is not null
      and reversed_by is not null
      and length(trim(coalesce(reversal_reason, ''))) >= 8)
  )
);

create unique index if not exists labour_bonus_payment_allocations_active_key
  on public.labour_bonus_payment_allocations(
    financial_transaction_id,
    bonus_payable_id
  )
  where reversed_at is null;

create index if not exists labour_bonus_payment_allocations_bonus_idx
  on public.labour_bonus_payment_allocations(
    bonus_payable_id,
    financial_transaction_id
  );

create table if not exists public.labour_payment_other_allocations (
  id uuid primary key default gen_random_uuid(),
  financial_transaction_id uuid not null
    references public.financial_transactions(id)
    on update cascade on delete restrict,
  contractor_id uuid not null
    references public.labour_contractors(id)
    on update cascade on delete restrict,
  companycam_project_id text
    references public.companycam_projects(companycam_id)
    on update cascade on delete restrict,
  allocation_type text not null
    check (
      allocation_type in (
        'advance',
        'materials_reimbursement',
        'overpayment_to_recover',
        'other'
      )
    ),
  allocated_amount numeric(12, 2) not null check (allocated_amount > 0),
  explanation text not null check (length(trim(explanation)) >= 8),
  inserted_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  reversed_by uuid references auth.users(id) on delete restrict,
  reversed_at timestamptz,
  reversal_reason text,
  check (
    (reversed_at is null
      and reversed_by is null
      and reversal_reason is null)
    or
    (reversed_at is not null
      and reversed_by is not null
      and length(trim(coalesce(reversal_reason, ''))) >= 8)
  )
);

create index if not exists labour_payment_other_allocations_transaction_idx
  on public.labour_payment_other_allocations(
    financial_transaction_id,
    contractor_id
  )
  where reversed_at is null;

create table if not exists public.labour_verification_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (
      entity_type in (
        'contractor',
        'invoice',
        'invoice_line',
        'job_allocation',
        'time_allocation',
        'payment',
        'invoice_payment',
        'bonus',
        'bonus_payment',
        'other_payment'
      )
    ),
  entity_id text not null check (length(trim(entity_id)) > 0),
  action text not null
    check (action in ('insert', 'update', 'reverse', 'delete')),
  old_values jsonb,
  new_values jsonb,
  reason text,
  performed_by uuid references auth.users(id) on delete set null,
  performed_at timestamptz not null default timezone('utc', now()),
  check (old_values is null or jsonb_typeof(old_values) = 'object'),
  check (new_values is null or jsonb_typeof(new_values) = 'object')
);

create index if not exists labour_verification_events_entity_idx
  on public.labour_verification_events(
    entity_type,
    entity_id,
    performed_at desc
  );

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

  if allocated_total > payment_amount + 0.01 then
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

    if allocated_total > target_amount + 0.01 then
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

    if allocated_total > target_amount + 0.01 then
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

create or replace function public.validate_labour_allocation_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  transaction_id uuid;
  invoice_id uuid;
  bonus_id uuid;
begin
  transaction_id := coalesce(
    (to_jsonb(new) ->> 'financial_transaction_id')::uuid,
    (to_jsonb(old) ->> 'financial_transaction_id')::uuid
  );
  invoice_id := coalesce(
    nullif(to_jsonb(new) ->> 'invoice_id', '')::uuid,
    nullif(to_jsonb(old) ->> 'invoice_id', '')::uuid
  );
  bonus_id := coalesce(
    nullif(to_jsonb(new) ->> 'bonus_payable_id', '')::uuid,
    nullif(to_jsonb(old) ->> 'bonus_payable_id', '')::uuid
  );

  perform public.assert_labour_payment_allocation(
    transaction_id,
    invoice_id,
    bonus_id
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
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

  if (line_amount >= 0 and allocation_total > line_amount + 0.01)
    or (line_amount < 0 and allocation_total < line_amount - 0.01) then
    raise exception
      'Job allocations % exceed invoice line amount %',
      allocation_total,
      line_amount;
  end if;
end;
$$;

create or replace function public.validate_labour_invoice_line_job_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.assert_labour_invoice_line_job_total(
    coalesce(new.invoice_line_id, old.invoice_line_id)
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.assert_labour_time_entry_allocation(
  target_time_entry_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  actual_hours numeric;
  allocated_hours numeric;
  time_worker_id uuid;
  mismatch_count integer;
begin
  select
    extract(epoch from (entry.ended_at - entry.started_at)) / 3600,
    entry.user_id
  into actual_hours, time_worker_id
  from public.time_entries entry
  where entry.id = target_time_entry_id
    and entry.ended_at is not null
    and entry.ended_at >= entry.started_at;

  if actual_hours is null then
    raise exception 'Only completed time entries can be allocated to invoices';
  end if;

  select
    coalesce(sum(link.allocated_hours), 0),
    count(*) filter (
      where contractor.worker_user_id is not null
        and contractor.worker_user_id <> time_worker_id
    )
  into allocated_hours, mismatch_count
  from public.labour_invoice_line_time_entries link
  join public.labour_invoice_lines line
    on line.id = link.invoice_line_id
  join public.labour_invoices invoice
    on invoice.id = line.invoice_id
  left join public.labour_contractors contractor
    on contractor.id = invoice.contractor_id
  where link.time_entry_id = target_time_entry_id;

  if allocated_hours > actual_hours + 0.0001 then
    raise exception
      'Allocated hours % exceed completed shift hours %',
      allocated_hours,
      actual_hours;
  end if;

  if mismatch_count > 0 then
    raise exception
      'Timesheet worker does not match the invoice contractor worker';
  end if;
end;
$$;

create or replace function public.validate_labour_time_entry_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.assert_labour_time_entry_allocation(
    coalesce(new.time_entry_id, old.time_entry_id)
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.validate_time_entry_existing_allocations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.labour_invoice_line_time_entries link
    where link.time_entry_id = new.id
  ) then
    perform public.assert_labour_time_entry_allocation(new.id);
  end if;
  return new;
end;
$$;

create or replace function public.validate_line_existing_job_allocations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.assert_labour_invoice_line_job_total(new.id);
  return new;
end;
$$;

create or replace function public.validate_invoice_existing_payments()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  payment_id uuid;
begin
  for payment_id in
    select distinct allocation.financial_transaction_id
    from public.labour_payment_allocations allocation
    where allocation.invoice_id = new.id
      and allocation.reversed_at is null
  loop
    perform public.assert_labour_payment_allocation(
      payment_id,
      new.id,
      null
    );
  end loop;
  return new;
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
    from public.labour_bonus_payment_allocations allocation
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

create or replace function public.validate_payment_record_contractor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.assert_labour_payment_allocation(
    new.financial_transaction_id,
    null,
    null
  );
  return new;
end;
$$;

create or replace function public.protect_labour_payment_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payment allocations must be reversed, not deleted';
  end if;

  if old.reversed_at is not null then
    raise exception 'A reversed payment allocation is immutable';
  end if;

  if new.financial_transaction_id <> old.financial_transaction_id
    or new.invoice_id <> old.invoice_id
    or new.allocated_amount <> old.allocated_amount
    or new.match_method <> old.match_method then
    raise exception
      'Payment allocation source, invoice, amount, and match evidence are immutable';
  end if;

  if new.reversed_at is null
    or new.reversed_by is null
    or length(trim(coalesce(new.reversal_reason, ''))) < 8 then
    raise exception 'Reversing an allocation requires user, time, and reason';
  end if;

  return new;
end;
$$;

create or replace function public.protect_generic_labour_payment_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payment allocations must be reversed, not deleted';
  end if;

  if old.reversed_at is not null then
    raise exception 'A reversed payment allocation is immutable';
  end if;

  if (to_jsonb(new) - array[
      'reversed_at',
      'reversed_by',
      'reversal_reason',
      'updated_at'
    ]) <> (to_jsonb(old) - array[
      'reversed_at',
      'reversed_by',
      'reversal_reason',
      'updated_at'
    ]) then
    raise exception 'Payment allocation values are immutable';
  end if;

  if new.reversed_at is null
    or new.reversed_by is null
    or length(trim(coalesce(new.reversal_reason, ''))) < 8 then
    raise exception 'Reversing an allocation requires user, time, and reason';
  end if;

  return new;
end;
$$;

create or replace function public.protect_approved_labour_bonus()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Approved bonuses must be reversed, not deleted';
  end if;

  if old.status = 'reversed' then
    raise exception 'A reversed bonus is immutable';
  end if;

  if new.contractor_id <> old.contractor_id
    or new.companycam_project_id <> old.companycam_project_id
    or new.worker_user_id is distinct from old.worker_user_id
    or new.amount <> old.amount
    or new.currency <> old.currency
    or new.formula_version <> old.formula_version
    or new.calculation_inputs <> old.calculation_inputs
    or new.approved_by <> old.approved_by
    or new.approved_at <> old.approved_at then
    raise exception 'Approved bonus values are immutable';
  end if;

  if new.status <> 'reversed'
    or new.reversed_by is null
    or new.reversed_at is null
    or length(trim(coalesce(new.reversal_reason, ''))) < 8 then
    raise exception 'Changing an approved bonus requires a documented reversal';
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
    when 'labour_bonus_payables' then 'bonus'
    when 'labour_bonus_payment_allocations' then 'bonus_payment'
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

drop trigger if exists protect_labour_payment_allocation
  on public.labour_payment_allocations;
create trigger protect_labour_payment_allocation
before update or delete on public.labour_payment_allocations
for each row execute function public.protect_labour_payment_allocation();

drop trigger if exists validate_labour_payment_allocation_totals
  on public.labour_payment_allocations;
create constraint trigger validate_labour_payment_allocation_totals
after insert or update or delete on public.labour_payment_allocations
deferrable initially immediate
for each row execute function public.validate_labour_allocation_totals();

create constraint trigger validate_labour_bonus_payment_allocation_totals
after insert or update or delete
on public.labour_bonus_payment_allocations
deferrable initially immediate
for each row execute function public.validate_labour_allocation_totals();

create constraint trigger validate_labour_other_payment_allocation_totals
after insert or update or delete
on public.labour_payment_other_allocations
deferrable initially immediate
for each row execute function public.validate_labour_allocation_totals();

create constraint trigger validate_labour_invoice_line_job_total
after insert or update or delete
on public.labour_invoice_line_allocations
deferrable initially immediate
for each row execute function public.validate_labour_invoice_line_job_total();

drop trigger if exists validate_line_existing_job_allocations
  on public.labour_invoice_lines;
create constraint trigger validate_line_existing_job_allocations
after update of amount_before_tax on public.labour_invoice_lines
deferrable initially immediate
for each row execute function public.validate_line_existing_job_allocations();

create constraint trigger validate_labour_time_entry_allocation
after insert or update or delete
on public.labour_invoice_line_time_entries
deferrable initially immediate
for each row execute function public.validate_labour_time_entry_allocation();

drop trigger if exists validate_time_entry_existing_allocations
  on public.time_entries;
create constraint trigger validate_time_entry_existing_allocations
after update of user_id, started_at, ended_at on public.time_entries
deferrable initially immediate
for each row execute function public.validate_time_entry_existing_allocations();

drop trigger if exists validate_invoice_existing_payments
  on public.labour_invoices;
create constraint trigger validate_invoice_existing_payments
after update of amount_paid, amount_before_tax, tax_amount, contractor_id, currency
on public.labour_invoices
deferrable initially immediate
for each row execute function public.validate_invoice_existing_payments();

drop trigger if exists validate_payment_existing_allocations
  on public.financial_transactions;
create constraint trigger validate_payment_existing_allocations
after update of amount, currency, transaction_type, is_transfer
on public.financial_transactions
deferrable initially immediate
for each row execute function public.validate_payment_existing_allocations();

create constraint trigger validate_payment_record_contractor
after insert or update on public.labour_payment_records
deferrable initially immediate
for each row execute function public.validate_payment_record_contractor();

create trigger protect_labour_bonus_payment_allocation
before update or delete on public.labour_bonus_payment_allocations
for each row
execute function public.protect_generic_labour_payment_allocation();

create trigger protect_labour_other_payment_allocation
before update or delete on public.labour_payment_other_allocations
for each row
execute function public.protect_generic_labour_payment_allocation();

create trigger protect_approved_labour_bonus
before update or delete on public.labour_bonus_payables
for each row execute function public.protect_approved_labour_bonus();

create trigger set_labour_payment_records_updated_at
before update on public.labour_payment_records
for each row execute function public.set_updated_at();

create trigger set_labour_bonus_payables_updated_at
before update on public.labour_bonus_payables
for each row execute function public.set_updated_at();

create trigger set_labour_bonus_payment_allocations_updated_at
before update on public.labour_bonus_payment_allocations
for each row execute function public.set_updated_at();

create trigger set_labour_payment_other_allocations_updated_at
before update on public.labour_payment_other_allocations
for each row execute function public.set_updated_at();

do $events$
declare
  table_name text;
begin
  foreach table_name in array array[
    'labour_contractors',
    'labour_invoice_lines',
    'labour_invoice_line_allocations',
    'labour_invoice_line_time_entries',
    'labour_payment_records',
    'labour_payment_allocations',
    'labour_bonus_payables',
    'labour_bonus_payment_allocations',
    'labour_payment_other_allocations'
  ]
  loop
    execute format(
      'drop trigger if exists log_labour_verification_event on public.%I',
      table_name
    );
    execute format(
      'create trigger log_labour_verification_event
       after insert or update or delete on public.%I
       for each row execute function public.log_labour_verification_event()',
      table_name
    );
  end loop;
end
$events$;

alter table public.labour_payment_records enable row level security;
alter table public.labour_bonus_payables enable row level security;
alter table public.labour_bonus_payment_allocations enable row level security;
alter table public.labour_payment_other_allocations enable row level security;
alter table public.labour_verification_events enable row level security;

do $policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'labour_payment_records',
    'labour_bonus_payables',
    'labour_bonus_payment_allocations',
    'labour_payment_other_allocations'
  ]
  loop
    execute format(
      'create policy "Managers can read %1$s" on public.%1$I
       for select to authenticated
       using (public.current_employee_role() in (''admin'', ''manager''))',
      table_name
    );
    execute format(
      'create policy "Managers can insert %1$s" on public.%1$I
       for insert to authenticated
       with check (public.current_employee_role() in (''admin'', ''manager''))',
      table_name
    );
    execute format(
      'create policy "Managers can update %1$s" on public.%1$I
       for update to authenticated
       using (public.current_employee_role() in (''admin'', ''manager''))
       with check (public.current_employee_role() in (''admin'', ''manager''))',
      table_name
    );
  end loop;
end
$policies$;

create policy "Managers can read labour verification events"
on public.labour_verification_events
for select
to authenticated
using (public.current_employee_role() in ('admin', 'manager'));

create policy "Managers can insert labour verification events"
on public.labour_verification_events
for insert
to authenticated
with check (
  public.current_employee_role() in ('admin', 'manager')
  and (performed_by is null or performed_by = auth.uid())
);

-- Normalize the known Fennec payment recipient without relying on an email.
insert into public.labour_payment_records (
  financial_transaction_id,
  contractor_id,
  recipient_status,
  confirmation_method,
  confirmation_note,
  confirmed_at
)
select
  allocation.financial_transaction_id,
  invoice.contractor_id,
  'confirmed',
  'manual_confirmation',
  'Recipient previously confirmed as Fennec Contracting / Bilal Akkacha.',
  allocation.confirmed_at
from public.labour_payment_allocations allocation
join public.labour_invoices invoice on invoice.id = allocation.invoice_id
where allocation.reversed_at is null
  and invoice.contractor_id is not null
on conflict (financial_transaction_id) do nothing;

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
bonus_allocations as (
  select
    allocation.financial_transaction_id,
    sum(allocation.allocated_amount)::numeric(14, 2) as bonus_amount,
    count(*)::integer as bonus_count
  from public.labour_bonus_payment_allocations allocation
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
  coalesce(bonuses.bonus_amount, 0)::numeric(14, 2)
    as bonus_allocated_amount,
  coalesce(other.other_amount, 0)::numeric(14, 2)
    as other_allocated_amount,
  (
    coalesce(invoices.invoice_amount, 0)
    + coalesce(bonuses.bonus_amount, 0)
    + coalesce(other.other_amount, 0)
  )::numeric(14, 2) as total_allocated_amount,
  (
    abs(transaction.amount)
    - coalesce(invoices.invoice_amount, 0)
    - coalesce(bonuses.bonus_amount, 0)
    - coalesce(other.other_amount, 0)
  )::numeric(14, 2) as unallocated_amount,
  coalesce(invoices.invoice_count, 0) as invoice_count,
  coalesce(bonuses.bonus_count, 0) as bonus_count,
  coalesce(other.other_count, 0) as other_count,
  case
    when coalesce(record.recipient_status, 'unknown') = 'unknown'
      then 'unidentified'
    when coalesce(invoices.invoice_count, 0)
      + coalesce(bonuses.bonus_count, 0)
      + coalesce(other.other_count, 0) = 0
      then 'unmatched'
    when (
      coalesce(invoices.invoice_amount, 0)
      + coalesce(bonuses.bonus_amount, 0)
      + coalesce(other.other_amount, 0)
    ) > abs(transaction.amount) + 0.01
      then 'needs_review'
    when (
      coalesce(invoices.invoice_amount, 0)
      + coalesce(bonuses.bonus_amount, 0)
      + coalesce(other.other_amount, 0)
    ) < abs(transaction.amount) - 0.01
      then 'partially_allocated'
    else 'fully_allocated'
  end as payment_status
from public.financial_transactions transaction
left join public.labour_payment_records record
  on record.financial_transaction_id = transaction.id
left join invoice_allocations invoices
  on invoices.financial_transaction_id = transaction.id
left join bonus_allocations bonuses
  on bonuses.financial_transaction_id = transaction.id
left join other_allocations other
  on other.financial_transaction_id = transaction.id
where transaction.transaction_type = 'expense'
  and not transaction.is_transfer
  and transaction.amount < 0
  and (
    transaction.category = 'Subcontractors'
    or record.financial_transaction_id is not null
  );

create or replace view public.labour_invoice_verification
with (security_invoker = true)
as
with line_totals as (
  select
    line.invoice_id,
    count(*)::integer as line_count,
    sum(line.amount_before_tax)::numeric(14, 2) as line_amount,
    sum(line.quantity_hours)::numeric(12, 4) as invoiced_hours,
    bool_or(line.needs_review) as needs_review
  from public.labour_invoice_lines line
  group by line.invoice_id
),
job_totals as (
  select
    line.invoice_id,
    count(allocation.companycam_project_id)::integer as job_count,
    sum(allocation.allocated_amount)::numeric(14, 2) as job_amount,
    bool_or(allocation.needs_review) as needs_review
  from public.labour_invoice_lines line
  join public.labour_invoice_line_allocations allocation
    on allocation.invoice_line_id = line.id
  group by line.invoice_id
),
time_totals as (
  select
    line.invoice_id,
    count(link.time_entry_id)::integer as time_entry_count,
    sum(link.allocated_hours)::numeric(12, 4) as backend_hours,
    bool_or(link.needs_review) as needs_review
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
  where allocation.reversed_at is null
  group by allocation.invoice_id
)
select
  invoice.id as invoice_id,
  invoice.contractor_id,
  invoice.supplier_name,
  invoice.invoice_number,
  invoice.invoice_date,
  invoice.currency,
  invoice.content_sha256,
  invoice.original_filename,
  invoice.storage_bucket,
  invoice.storage_path,
  coalesce(
    invoice.amount_paid,
    coalesce(invoice.amount_before_tax, 0)
      + coalesce(invoice.tax_amount, 0)
  )::numeric(14, 2) as invoice_amount,
  coalesce(lines.line_count, 0) as line_count,
  coalesce(lines.line_amount, 0)::numeric(14, 2) as line_amount,
  (
    coalesce(lines.line_amount, 0)
    - coalesce(invoice.amount_before_tax, 0)
  )::numeric(14, 2) as invoice_line_difference,
  coalesce(jobs.job_count, 0) as job_count,
  coalesce(jobs.job_amount, 0)::numeric(14, 2) as job_amount,
  (
    coalesce(jobs.job_amount, 0)
    - coalesce(lines.line_amount, 0)
  )::numeric(14, 2) as job_difference,
  coalesce(lines.invoiced_hours, 0)::numeric(12, 4) as invoiced_hours,
  coalesce(times.backend_hours, 0)::numeric(12, 4) as backend_hours,
  (
    coalesce(times.backend_hours, 0)
    - coalesce(lines.invoiced_hours, 0)
  )::numeric(12, 4) as hours_difference,
  coalesce(payments.payment_count, 0) as payment_count,
  coalesce(payments.paid_amount, 0)::numeric(14, 2) as paid_amount,
  greatest(
    coalesce(
      invoice.amount_paid,
      coalesce(invoice.amount_before_tax, 0)
        + coalesce(invoice.tax_amount, 0)
    ) - coalesce(payments.paid_amount, 0),
    0
  )::numeric(14, 2) as amount_remaining,
  case
    when coalesce(payments.paid_amount, 0) = 0 then 'unpaid'
    when coalesce(payments.paid_amount, 0) <
      coalesce(
        invoice.amount_paid,
        coalesce(invoice.amount_before_tax, 0)
          + coalesce(invoice.tax_amount, 0)
      ) - 0.01 then 'partially_paid'
    when coalesce(payments.paid_amount, 0) >
      coalesce(
        invoice.amount_paid,
        coalesce(invoice.amount_before_tax, 0)
          + coalesce(invoice.tax_amount, 0)
      ) + 0.01 then 'overpaid'
    else 'paid'
  end as payment_status,
  case
    when invoice.contractor_id is null
      or coalesce(lines.line_count, 0) = 0 then 'needs_information'
    when abs(
      coalesce(lines.line_amount, 0)
      - coalesce(invoice.amount_before_tax, 0)
    ) > 0.01
      or abs(
        coalesce(jobs.job_amount, 0)
        - coalesce(lines.line_amount, 0)
      ) > 0.01
      or (
        coalesce(lines.invoiced_hours, 0) > 0
        and abs(
          coalesce(times.backend_hours, 0)
          - coalesce(lines.invoiced_hours, 0)
        ) > 0.0167
      )
      or coalesce(lines.needs_review, false)
      or coalesce(jobs.needs_review, false)
      or coalesce(times.needs_review, false)
      then 'needs_review'
    else 'verified'
  end as verification_status
from public.labour_invoices invoice
left join line_totals lines on lines.invoice_id = invoice.id
left join job_totals jobs on jobs.invoice_id = invoice.id
left join time_totals times on times.invoice_id = invoice.id
left join payment_totals payments on payments.invoice_id = invoice.id
where invoice.document_type = 'invoice';

comment on table public.labour_payment_records is
  'Verified recipient identity for an outgoing subcontractor bank transaction.';
comment on table public.labour_bonus_payables is
  'Immutable approved subcontractor bonuses; live estimates are not stored here.';
comment on table public.labour_bonus_payment_allocations is
  'Bank-payment allocations to approved subcontractor bonuses.';
comment on table public.labour_payment_other_allocations is
  'Explained non-invoice portions of a contractor payment, such as advances or reimbursements.';
comment on table public.labour_verification_events is
  'Append-only history for subcontractor verification records and corrections.';

commit;
