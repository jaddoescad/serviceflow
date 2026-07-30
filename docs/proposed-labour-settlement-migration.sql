-- UNAPPLIED PROPOSAL
-- Normalizes subcontractor payments, invoice entries, job allocations, and
-- timesheet reconciliation. Review and apply in development/staging first.

begin;

create table if not exists public.labour_contractors (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null check (length(trim(supplier_name)) > 0),
  worker_user_id uuid
    references public.employee_profiles(user_id) on delete set null,
  is_active boolean not null default true,
  notes text,
  inserted_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists labour_contractors_supplier_name_key
  on public.labour_contractors (lower(trim(supplier_name)));

create index if not exists labour_contractors_worker_idx
  on public.labour_contractors (worker_user_id)
  where worker_user_id is not null;

alter table public.labour_invoices
  add column if not exists contractor_id uuid
    references public.labour_contractors(id) on delete set null;

create index if not exists labour_invoices_contractor_date_idx
  on public.labour_invoices(contractor_id, invoice_date desc);

create table if not exists public.labour_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null
    references public.labour_invoices(id) on update cascade on delete cascade,
  line_number integer not null check (line_number > 0),
  description text not null check (length(trim(description)) > 0),
  service_started_on date,
  service_ended_on date,
  quantity_hours numeric(9, 4)
    check (quantity_hours is null or quantity_hours >= 0),
  hourly_rate numeric(12, 2)
    check (hourly_rate is null or hourly_rate >= 0),
  amount_before_tax numeric(12, 2) not null,
  is_adjustment boolean not null default false,
  source_kind text not null default 'extracted'
    check (source_kind in ('extracted', 'manual', 'legacy_project_link')),
  source_text text,
  needs_review boolean not null default false,
  inserted_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (invoice_id, line_number),
  check (
    service_started_on is null
    or service_ended_on is null
    or service_started_on <= service_ended_on
  ),
  check (amount_before_tax >= 0 or is_adjustment)
);

create index if not exists labour_invoice_lines_invoice_idx
  on public.labour_invoice_lines(invoice_id, line_number);

create index if not exists labour_invoice_lines_service_date_idx
  on public.labour_invoice_lines(service_started_on, invoice_id)
  where service_started_on is not null;

create table if not exists public.labour_invoice_line_allocations (
  invoice_line_id uuid not null
    references public.labour_invoice_lines(id)
    on update cascade on delete cascade,
  companycam_project_id text not null
    references public.companycam_projects(companycam_id)
    on update cascade on delete restrict,
  allocated_amount numeric(12, 2) not null,
  allocated_hours numeric(9, 4)
    check (allocated_hours is null or allocated_hours >= 0),
  allocation_method text[] not null default '{}',
  needs_review boolean not null default false,
  inserted_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (invoice_line_id, companycam_project_id)
);

create index if not exists labour_invoice_line_allocations_project_idx
  on public.labour_invoice_line_allocations(
    companycam_project_id,
    invoice_line_id
  );

create table if not exists public.labour_invoice_line_time_entries (
  invoice_line_id uuid not null
    references public.labour_invoice_lines(id)
    on update cascade on delete cascade,
  time_entry_id uuid not null
    references public.time_entries(id)
    on update cascade on delete restrict,
  allocated_hours numeric(9, 4) not null check (allocated_hours > 0),
  match_method text[] not null default '{}',
  needs_review boolean not null default false,
  inserted_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (invoice_line_id, time_entry_id)
);

create index if not exists labour_invoice_line_time_entries_time_idx
  on public.labour_invoice_line_time_entries(time_entry_id, invoice_line_id);

create table if not exists public.labour_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  financial_transaction_id uuid not null
    references public.financial_transactions(id)
    on update cascade on delete restrict,
  invoice_id uuid not null
    references public.labour_invoices(id)
    on update cascade on delete restrict,
  allocated_amount numeric(12, 2) not null check (allocated_amount > 0),
  match_method text[] not null default '{}',
  invoice_source_message_id text,
  payment_confirmation_message_id text,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  notes text,
  inserted_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (financial_transaction_id, invoice_id)
);

create index if not exists labour_payment_allocations_invoice_idx
  on public.labour_payment_allocations(invoice_id, financial_transaction_id);

create table if not exists public.labour_reconciliation_resolutions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid
    references public.labour_invoices(id)
    on update cascade on delete cascade,
  invoice_line_id uuid
    references public.labour_invoice_lines(id)
    on update cascade on delete cascade,
  financial_transaction_id uuid
    references public.financial_transactions(id)
    on update cascade on delete cascade,
  variance_kind text not null
    check (
      variance_kind in (
        'contractor_identity',
        'invoice_total',
        'job_amount',
        'payment_amount',
        'hours'
      )
    ),
  resolution_code text not null
    check (
      resolution_code in (
        'corrected_source',
        'rounding',
        'bonus',
        'deduction',
        'missing_timesheet',
        'invoice_error',
        'approved_exception',
        'other'
      )
    ),
  note text not null check (length(trim(note)) >= 8),
  resolved_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  resolved_at timestamptz not null default timezone('utc', now()),
  inserted_at timestamptz not null default timezone('utc', now()),
  check (
    num_nonnulls(invoice_id, invoice_line_id, financial_transaction_id) = 1
  )
);

create index if not exists labour_reconciliation_resolutions_invoice_idx
  on public.labour_reconciliation_resolutions(invoice_id, variance_kind)
  where invoice_id is not null;

create index if not exists labour_reconciliation_resolutions_line_idx
  on public.labour_reconciliation_resolutions(invoice_line_id, variance_kind)
  where invoice_line_id is not null;

create index if not exists labour_reconciliation_resolutions_transaction_idx
  on public.labour_reconciliation_resolutions(
    financial_transaction_id,
    variance_kind
  )
  where financial_transaction_id is not null;

create or replace function public.validate_labour_payment_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  payment_row public.financial_transactions;
  invoice_row public.labour_invoices;
begin
  select *
  into payment_row
  from public.financial_transactions
  where id = new.financial_transaction_id;

  if payment_row.id is null then
    raise exception 'Financial transaction does not exist';
  end if;

  if payment_row.transaction_type <> 'expense'
    or payment_row.is_transfer
    or payment_row.amount >= 0 then
    raise exception 'Labour payments must reference a negative non-transfer expense';
  end if;

  select *
  into invoice_row
  from public.labour_invoices
  where id = new.invoice_id;

  if invoice_row.id is null or invoice_row.document_type <> 'invoice' then
    raise exception 'Labour payment allocations must reference an invoice';
  end if;

  if payment_row.currency <> invoice_row.currency then
    raise exception 'Payment and invoice currencies must match';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_labour_payment_allocation
  on public.labour_payment_allocations;
create trigger validate_labour_payment_allocation
before insert or update on public.labour_payment_allocations
for each row execute function public.validate_labour_payment_allocation();

drop trigger if exists set_labour_contractors_updated_at
  on public.labour_contractors;
create trigger set_labour_contractors_updated_at
before update on public.labour_contractors
for each row execute function public.set_updated_at();

drop trigger if exists set_labour_invoice_lines_updated_at
  on public.labour_invoice_lines;
create trigger set_labour_invoice_lines_updated_at
before update on public.labour_invoice_lines
for each row execute function public.set_updated_at();

drop trigger if exists set_labour_invoice_line_allocations_updated_at
  on public.labour_invoice_line_allocations;
create trigger set_labour_invoice_line_allocations_updated_at
before update on public.labour_invoice_line_allocations
for each row execute function public.set_updated_at();

drop trigger if exists set_labour_invoice_line_time_entries_updated_at
  on public.labour_invoice_line_time_entries;
create trigger set_labour_invoice_line_time_entries_updated_at
before update on public.labour_invoice_line_time_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_labour_payment_allocations_updated_at
  on public.labour_payment_allocations;
create trigger set_labour_payment_allocations_updated_at
before update on public.labour_payment_allocations
for each row execute function public.set_updated_at();

alter table public.labour_contractors enable row level security;
alter table public.labour_invoice_lines enable row level security;
alter table public.labour_invoice_line_allocations enable row level security;
alter table public.labour_invoice_line_time_entries enable row level security;
alter table public.labour_payment_allocations enable row level security;
alter table public.labour_reconciliation_resolutions enable row level security;

-- Admins and managers can perform reconciliation work. Deletes remain
-- admin-only so allocation history cannot be silently removed by managers.
do $policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'labour_contractors',
    'labour_invoice_lines',
    'labour_invoice_line_allocations',
    'labour_invoice_line_time_entries',
    'labour_payment_allocations'
  ]
  loop
    execute format(
      'drop policy if exists "Managers can read %1$s" on public.%1$I',
      table_name
    );
    execute format(
      'create policy "Managers can read %1$s" on public.%1$I
       for select to authenticated
       using (public.current_employee_role() in (''admin'', ''manager''))',
      table_name
    );

    execute format(
      'drop policy if exists "Managers can insert %1$s" on public.%1$I',
      table_name
    );
    execute format(
      'create policy "Managers can insert %1$s" on public.%1$I
       for insert to authenticated
       with check (public.current_employee_role() in (''admin'', ''manager''))',
      table_name
    );

    execute format(
      'drop policy if exists "Managers can update %1$s" on public.%1$I',
      table_name
    );
    execute format(
      'create policy "Managers can update %1$s" on public.%1$I
       for update to authenticated
       using (public.current_employee_role() in (''admin'', ''manager''))
       with check (public.current_employee_role() in (''admin'', ''manager''))',
      table_name
    );

    execute format(
      'drop policy if exists "Admins can delete %1$s" on public.%1$I',
      table_name
    );
    execute format(
      'create policy "Admins can delete %1$s" on public.%1$I
       for delete to authenticated
       using (public.current_employee_role() = ''admin'')',
      table_name
    );
  end loop;
end
$policies$;

drop policy if exists "Managers can read labour reconciliation resolutions"
  on public.labour_reconciliation_resolutions;
create policy "Managers can read labour reconciliation resolutions"
on public.labour_reconciliation_resolutions
for select
to authenticated
using (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can insert labour reconciliation resolutions"
  on public.labour_reconciliation_resolutions;
create policy "Managers can insert labour reconciliation resolutions"
on public.labour_reconciliation_resolutions
for insert
to authenticated
with check (
  public.current_employee_role() in ('admin', 'manager')
  and resolved_by = auth.uid()
);

-- Create one contractor identity per existing supplier and attach invoices.
insert into public.labour_contractors (supplier_name)
select source.supplier_name
from (
  select distinct on (lower(trim(invoice.supplier_name)))
    trim(invoice.supplier_name) as supplier_name
  from public.labour_invoices invoice
  where length(trim(invoice.supplier_name)) > 0
  order by lower(trim(invoice.supplier_name)), invoice.inserted_at
) source
where not exists (
  select 1
  from public.labour_contractors contractor
  where lower(trim(contractor.supplier_name)) =
    lower(trim(source.supplier_name))
);

update public.labour_invoices invoice
set contractor_id = contractor.id
from public.labour_contractors contractor
where invoice.contractor_id is null
  and lower(trim(invoice.supplier_name)) =
    lower(trim(contractor.supplier_name));

-- Preserve the only current JSON settlement as a normalized allocation.
insert into public.labour_payment_allocations (
  financial_transaction_id,
  invoice_id,
  allocated_amount,
  match_method,
  invoice_source_message_id,
  payment_confirmation_message_id,
  confirmed_at,
  notes
)
select
  transaction.id,
  invoice.id,
  abs((settlement.value ->> 'allocated_amount')::numeric),
  case
    when jsonb_typeof(settlement.value -> 'match_method') = 'array'
      and jsonb_array_length(settlement.value -> 'match_method') > 0
    then array(
      select jsonb_array_elements_text(
        settlement.value -> 'match_method'
      )
    )
    else array['legacy_source_data']::text[]
  end,
  nullif(settlement.value ->> 'invoice_source_message_id', ''),
  nullif(settlement.value ->> 'payment_confirmation_message_id', ''),
  transaction.updated_at,
  'Backfilled from financial_transactions.source_data.settlements'
from public.financial_transactions transaction
cross join lateral jsonb_array_elements(
  coalesce(transaction.source_data -> 'settlements', '[]'::jsonb)
) settlement(value)
join public.labour_invoices invoice
  on invoice.id::text = settlement.value ->> 'labour_invoice_id'
where settlement.value ->> 'kind' = 'labour_invoice'
  and settlement.value ->> 'labour_invoice_id'
    ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (settlement.value ->> 'allocated_amount')
    ~ '^[0-9]+(?:\.[0-9]+)?$'
on conflict (financial_transaction_id, invoice_id) do nothing;

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
),
resolved as (
  select
    resolution.financial_transaction_id,
    bool_or(resolution.variance_kind = 'payment_amount')
      as payment_amount_resolved
  from public.labour_reconciliation_resolutions resolution
  where resolution.financial_transaction_id is not null
  group by resolution.financial_transaction_id
)
select
  transaction.id as financial_transaction_id,
  transaction.posted_on,
  transaction.counterparty,
  transaction.description,
  transaction.currency,
  abs(transaction.amount)::numeric(14, 2) as payment_amount,
  coalesce(totals.allocated_amount, 0)::numeric(14, 2)
    as allocated_amount,
  (
    abs(transaction.amount) - coalesce(totals.allocated_amount, 0)
  )::numeric(14, 2) as unallocated_amount,
  coalesce(totals.invoice_count, 0) as invoice_count,
  coalesce(totals.contractor_count, 0) as contractor_count,
  case
    when coalesce(totals.invoice_count, 0) = 0 then 'needs_review'
    when coalesce(totals.contractor_count, 0) <> 1 then 'mismatch'
    when coalesce(totals.allocated_amount, 0) >
      abs(transaction.amount) + 0.01
      and not coalesce(resolved.payment_amount_resolved, false)
      then 'mismatch'
    when coalesce(totals.allocated_amount, 0) <
      abs(transaction.amount) - 0.01
      and not coalesce(resolved.payment_amount_resolved, false)
      then 'partial'
    else 'settled'
  end as settlement_status
from public.financial_transactions transaction
left join allocation_totals totals
  on totals.financial_transaction_id = transaction.id
left join resolved
  on resolved.financial_transaction_id = transaction.id
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
    count(*) filter (
      where line.quantity_hours is not null
    )::integer as lines_with_hours,
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
),
resolved as (
  select
    coalesce(resolution.invoice_id, line.invoice_id) as invoice_id,
    bool_or(resolution.variance_kind = 'invoice_total')
      as invoice_total_resolved,
    bool_or(resolution.variance_kind = 'job_amount')
      as job_amount_resolved,
    bool_or(resolution.variance_kind = 'payment_amount')
      as payment_amount_resolved,
    bool_or(resolution.variance_kind = 'hours')
      as hours_resolved
  from public.labour_reconciliation_resolutions resolution
  left join public.labour_invoice_lines line
    on line.id = resolution.invoice_line_id
  where coalesce(resolution.invoice_id, line.invoice_id) is not null
  group by coalesce(resolution.invoice_id, line.invoice_id)
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
    coalesce(lines.line_amount, 0) -
    coalesce(invoice.amount_before_tax, 0)
  )::numeric(14, 2) as invoice_line_variance,
  coalesce(jobs.project_allocation_count, 0) as project_allocation_count,
  coalesce(jobs.job_allocated_amount, 0)::numeric(14, 2)
    as job_allocated_amount,
  (
    coalesce(jobs.job_allocated_amount, 0) -
    coalesce(lines.line_amount, 0)
  )::numeric(14, 2) as job_allocation_variance,
  coalesce(payments.payment_count, 0) as payment_count,
  coalesce(payments.paid_amount, 0)::numeric(14, 2) as paid_amount,
  (
    coalesce(payments.paid_amount, 0) -
    coalesce(
      invoice.amount_paid,
      coalesce(invoice.amount_before_tax, 0) +
        coalesce(invoice.tax_amount, 0)
    )
  )::numeric(14, 2) as payment_variance,
  coalesce(lines.invoiced_hours, 0)::numeric(12, 4) as invoiced_hours,
  coalesce(times.linked_time_hours, 0)::numeric(12, 4)
    as linked_time_hours,
  (
    coalesce(times.linked_time_hours, 0) -
    coalesce(lines.invoiced_hours, 0)
  )::numeric(12, 4) as hours_variance,
  case
    when invoice.contractor_id is null
      or coalesce(lines.line_count, 0) = 0 then 'needs_review'
    when coalesce(jobs.project_allocation_count, 0) = 0
      or coalesce(payments.payment_count, 0) = 0 then 'partial'
    when abs(
      coalesce(lines.line_amount, 0) -
      coalesce(invoice.amount_before_tax, 0)
    ) > 0.01
      and not coalesce(resolved.invoice_total_resolved, false)
      then 'mismatch'
    when abs(
      coalesce(jobs.job_allocated_amount, 0) -
      coalesce(lines.line_amount, 0)
    ) > 0.01
      and not coalesce(resolved.job_amount_resolved, false)
      then 'mismatch'
    when abs(
      coalesce(payments.paid_amount, 0) -
      coalesce(
        invoice.amount_paid,
        coalesce(invoice.amount_before_tax, 0) +
          coalesce(invoice.tax_amount, 0)
      )
    ) > 0.01
      and not coalesce(resolved.payment_amount_resolved, false)
      then 'mismatch'
    when coalesce(lines.lines_with_hours, 0) > 0
      and abs(
        coalesce(times.linked_time_hours, 0) -
        coalesce(lines.invoiced_hours, 0)
      ) > 0.0167
      and not coalesce(resolved.hours_resolved, false)
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
left join resolved on resolved.invoice_id = invoice.id
where invoice.document_type = 'invoice';

comment on table public.labour_contractors is
  'Stable subcontractor/supplier identities optionally linked to employee profiles.';

comment on table public.labour_invoice_lines is
  'Individual source entries printed on an archived labour invoice.';

comment on table public.labour_invoice_line_allocations is
  'Dollar/hour splits from an invoice entry to one or more CompanyCam jobs.';

comment on table public.labour_invoice_line_time_entries is
  'Explicit audit links between invoice entries and backend time entries.';

comment on table public.labour_payment_allocations is
  'Normalized many-to-many allocations from bank transactions to labour invoices.';

comment on table public.labour_reconciliation_resolutions is
  'Auditable explanations for accepted contractor, invoice, payment, job, or hour variances.';

commit;
