begin;

create table if not exists public.material_invoice_documents (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  external_message_id text,
  source_reference text,
  document_date date,
  original_filename text not null,
  mime_type text not null default 'application/pdf',
  file_size integer not null,
  content_sha256 text not null,
  storage_bucket text not null default 'material-invoices',
  storage_path text not null,
  page_count integer,
  extracted_text text,
  source_payload jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  inserted_at timestamptz not null default now(),
  inserted_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint material_invoice_documents_source_unique
    unique (source_system, external_message_id, original_filename),
  constraint material_invoice_documents_path_unique
    unique (storage_bucket, storage_path),
  constraint material_invoice_documents_hash_check
    check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint material_invoice_documents_file_size_check
    check (file_size > 0),
  constraint material_invoice_documents_page_count_check
    check (page_count is null or page_count > 0)
);

create table if not exists public.material_invoices (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null
    references public.material_invoice_documents(id) on delete restrict,
  source_system text not null,
  external_invoice_id text not null,
  source_page_start integer,
  source_page_end integer,
  supplier_name text not null,
  account_number text,
  job_account text,
  invoice_number text not null,
  invoice_type text not null default 'charge_invoice',
  invoice_date date not null,
  invoice_time time,
  due_on date,
  po_number text,
  order_number text,
  store_number text,
  store_address text,
  received_by text,
  currency text not null default 'CAD',
  amount_before_tax numeric(14, 2) not null,
  tax_amount numeric(14, 2) not null,
  total_amount numeric(14, 2) not null,
  extraction_status text not null default 'needs_extraction',
  source_text text,
  source_payload jsonb not null default '{}'::jsonb,
  inserted_at timestamptz not null default now(),
  inserted_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint material_invoices_source_unique
    unique (source_system, external_invoice_id),
  constraint material_invoices_type_check
    check (invoice_type in ('charge_invoice', 'cash_receipt', 'return', 'credit_memo')),
  constraint material_invoices_currency_check
    check (currency in ('CAD', 'USD')),
  constraint material_invoices_extraction_check
    check (extraction_status in ('needs_extraction', 'extracted', 'needs_review', 'verified')),
  constraint material_invoices_pages_check
    check (
      (source_page_start is null and source_page_end is null)
      or (
        source_page_start is not null
        and source_page_end is not null
        and source_page_start > 0
        and source_page_end >= source_page_start
      )
    ),
  constraint material_invoices_arithmetic_check
    check (abs((amount_before_tax + tax_amount) - total_amount) <= 0.02)
);

create index if not exists material_invoices_document_idx
  on public.material_invoices(document_id, source_page_start);
create index if not exists material_invoices_supplier_date_idx
  on public.material_invoices(supplier_name, invoice_date desc);
create index if not exists material_invoices_po_idx
  on public.material_invoices(po_number)
  where po_number is not null;

create table if not exists public.material_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  material_invoice_id uuid not null
    references public.material_invoices(id) on delete restrict,
  line_number integer not null,
  line_type text not null default 'product',
  sales_number text,
  size text,
  product_code text,
  description text not null,
  color_code text,
  color_name text,
  quantity numeric(14, 4),
  unit_price numeric(14, 4),
  gross_amount numeric(14, 2) not null default 0,
  discount_amount numeric(14, 2) not null default 0,
  amount_before_tax numeric(14, 2) not null,
  tax_amount numeric(14, 2) not null default 0,
  total_amount numeric(14, 2) not null,
  source_text text,
  source_payload jsonb not null default '{}'::jsonb,
  needs_review boolean not null default false,
  inserted_at timestamptz not null default now(),
  inserted_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint material_invoice_lines_invoice_line_unique
    unique (material_invoice_id, line_number),
  constraint material_invoice_lines_type_check
    check (line_type in ('product', 'discount', 'fee', 'return', 'adjustment')),
  constraint material_invoice_lines_quantity_check
    check (quantity is null or quantity <> 0),
  constraint material_invoice_lines_arithmetic_check
    check (abs((amount_before_tax + tax_amount) - total_amount) <= 0.02)
);

create index if not exists material_invoice_lines_invoice_idx
  on public.material_invoice_lines(material_invoice_id, line_number);
create index if not exists material_invoice_lines_product_idx
  on public.material_invoice_lines(sales_number, product_code);

create table if not exists public.material_invoice_line_allocations (
  id uuid primary key default gen_random_uuid(),
  material_invoice_line_id uuid not null
    references public.material_invoice_lines(id) on delete restrict,
  allocation_scope text not null,
  companycam_project_id text
    references public.companycam_projects(companycam_id) on delete restrict,
  overhead_category text,
  allocated_quantity numeric(14, 4),
  allocated_before_tax numeric(14, 2) not null,
  allocated_tax numeric(14, 2) not null,
  allocated_total numeric(14, 2) not null,
  allocation_method text not null,
  evidence_reference text,
  confidence numeric(5, 4),
  needs_review boolean not null default false,
  source_payload jsonb not null default '{}'::jsonb,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text,
  inserted_at timestamptz not null default now(),
  inserted_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint material_line_allocations_scope_check
    check (
      (allocation_scope = 'job' and companycam_project_id is not null and overhead_category is null)
      or
      (allocation_scope = 'overhead' and companycam_project_id is null and overhead_category is not null)
    ),
  constraint material_line_allocations_method_check
    check (allocation_method in ('po_exact', 'address_exact', 'customer_exact', 'manual', 'overhead_rule')),
  constraint material_line_allocations_confidence_check
    check (confidence is null or confidence between 0 and 1),
  constraint material_line_allocations_arithmetic_check
    check (abs((allocated_before_tax + allocated_tax) - allocated_total) <= 0.02),
  constraint material_line_allocations_reversal_check
    check (
      (reversed_at is null and reversed_by is null and reversal_reason is null)
      or
      (reversed_at is not null and reversal_reason is not null)
    )
);

create index if not exists material_line_allocations_line_idx
  on public.material_invoice_line_allocations(material_invoice_line_id)
  where reversed_at is null;
create index if not exists material_line_allocations_project_idx
  on public.material_invoice_line_allocations(companycam_project_id)
  where reversed_at is null and companycam_project_id is not null;

create table if not exists public.material_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  financial_transaction_id uuid not null
    references public.financial_transactions(id) on delete restrict,
  material_invoice_id uuid not null
    references public.material_invoices(id) on delete restrict,
  allocated_amount numeric(14, 2) not null,
  allocation_method text not null,
  evidence_reference text,
  confidence numeric(5, 4),
  needs_review boolean not null default false,
  source_payload jsonb not null default '{}'::jsonb,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text,
  inserted_at timestamptz not null default now(),
  inserted_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint material_payment_allocations_amount_positive
    check (allocated_amount > 0),
  constraint material_payment_allocations_method_check
    check (allocation_method in ('statement_exact', 'date_amount_exact', 'manual')),
  constraint material_payment_allocations_confidence_check
    check (confidence is null or confidence between 0 and 1),
  constraint material_payment_allocations_reversal_check
    check (
      (reversed_at is null and reversed_by is null and reversal_reason is null)
      or
      (reversed_at is not null and reversal_reason is not null)
    )
);

create index if not exists material_payment_allocations_transaction_idx
  on public.material_payment_allocations(financial_transaction_id)
  where reversed_at is null;
create index if not exists material_payment_allocations_invoice_idx
  on public.material_payment_allocations(material_invoice_id)
  where reversed_at is null;
create unique index if not exists material_payment_allocations_active_unique
  on public.material_payment_allocations(financial_transaction_id, material_invoice_id)
  where reversed_at is null;

create or replace function public.validate_material_line_allocation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  line_row public.material_invoice_lines%rowtype;
  active_before_tax numeric(14, 2);
  active_tax numeric(14, 2);
  active_total numeric(14, 2);
begin
  if new.reversed_at is not null then return new; end if;

  select * into line_row
  from public.material_invoice_lines
  where id = new.material_invoice_line_id;
  if line_row.id is null then
    raise exception 'Material invoice line % does not exist', new.material_invoice_line_id;
  end if;

  select
    coalesce(sum(allocated_before_tax), 0),
    coalesce(sum(allocated_tax), 0),
    coalesce(sum(allocated_total), 0)
  into active_before_tax, active_tax, active_total
  from public.material_invoice_line_allocations
  where material_invoice_line_id = new.material_invoice_line_id
    and reversed_at is null
    and id is distinct from new.id;

  if abs(active_before_tax + new.allocated_before_tax) > abs(line_row.amount_before_tax) + 0.02
    or abs(active_tax + new.allocated_tax) > abs(line_row.tax_amount) + 0.02
    or abs(active_total + new.allocated_total) > abs(line_row.total_amount) + 0.02 then
    raise exception 'Material line allocation exceeds the source line total';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_material_line_allocation
  on public.material_invoice_line_allocations;
create trigger validate_material_line_allocation
before insert or update on public.material_invoice_line_allocations
for each row execute function public.validate_material_line_allocation();

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
  if invoice_row.id is null then
    raise exception 'Material invoice % does not exist', new.material_invoice_id;
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

  if active_transaction_total + new.allocated_amount > abs(transaction_row.amount) + 0.02 then
    raise exception 'Material allocations exceed the bank transaction total';
  end if;
  if active_invoice_total + new.allocated_amount > abs(invoice_row.total_amount) + 0.02 then
    raise exception 'Material allocations exceed the invoice total';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_material_payment_allocation
  on public.material_payment_allocations;
create trigger validate_material_payment_allocation
before insert or update on public.material_payment_allocations
for each row execute function public.validate_material_payment_allocation();

create or replace function public.protect_material_allocation_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.reversed_at is distinct from old.reversed_at
    or new.reversed_by is distinct from old.reversed_by
    or new.reversal_reason is distinct from old.reversal_reason then
    if old.reversed_at is not null then
      raise exception 'A reversed allocation cannot be changed';
    end if;
    return new;
  end if;
  if new is distinct from old then
    raise exception 'Allocations are append-only; reverse and replace instead';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_material_line_allocation_history
  on public.material_invoice_line_allocations;
create trigger protect_material_line_allocation_history
before update on public.material_invoice_line_allocations
for each row execute function public.protect_material_allocation_history();

drop trigger if exists protect_material_payment_allocation_history
  on public.material_payment_allocations;
create trigger protect_material_payment_allocation_history
before update on public.material_payment_allocations
for each row execute function public.protect_material_allocation_history();

create or replace view public.material_invoice_verification
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
  (invoice.total_amount - coalesce(payments.paid_amount, 0))::numeric(14, 2) as amount_remaining,
  case
    when invoice.extraction_status in ('needs_extraction', 'needs_review') then 'needs_review'
    when coalesce(lines.line_count, 0) = 0 then 'needs_review'
    when abs(coalesce(lines.line_amount_before_tax, 0) - invoice.amount_before_tax) > 0.02 then 'needs_review'
    when abs(coalesce(lines.line_tax_amount, 0) - invoice.tax_amount) > 0.02 then 'needs_review'
    when coalesce(lines.line_needs_review, false) then 'needs_review'
    when abs(coalesce(jobs.allocated_total, 0) - invoice.total_amount) > 0.02 then 'needs_review'
    when coalesce(jobs.allocation_needs_review, false) then 'needs_review'
    when coalesce(payments.paid_amount, 0) > abs(invoice.total_amount) + 0.02 then 'needs_review'
    when coalesce(payments.payment_needs_review, false) then 'needs_review'
    when coalesce(payments.paid_amount, 0) < abs(invoice.total_amount) - 0.02 then 'unpaid'
    else 'verified'
  end as verification_status
from public.material_invoices invoice
left join line_totals lines on lines.material_invoice_id = invoice.id
left join job_totals jobs on jobs.material_invoice_id = invoice.id
left join payment_totals payments on payments.material_invoice_id = invoice.id;

create or replace view public.material_payment_verification
with (security_invoker = true)
as
select
  transaction.id as financial_transaction_id,
  transaction.posted_on,
  abs(transaction.amount)::numeric(14, 2) as payment_amount,
  transaction.currency,
  coalesce(allocation.invoice_count, 0) as invoice_count,
  coalesce(allocation.allocated_amount, 0)::numeric(14, 2) as allocated_amount,
  (abs(transaction.amount) - coalesce(allocation.allocated_amount, 0))::numeric(14, 2) as unallocated_amount,
  case
    when coalesce(allocation.invoice_count, 0) = 0 then 'unmatched'
    when coalesce(allocation.needs_review, false) then 'needs_review'
    when coalesce(allocation.allocated_amount, 0) > abs(transaction.amount) + 0.02 then 'needs_review'
    when coalesce(allocation.allocated_amount, 0) < abs(transaction.amount) - 0.02 then 'partially_allocated'
    else 'fully_allocated'
  end as payment_status
from public.financial_transactions transaction
left join lateral (
  select
    count(distinct payment.material_invoice_id)::integer as invoice_count,
    sum(payment.allocated_amount)::numeric(14, 2) as allocated_amount,
    bool_or(payment.needs_review) as needs_review
  from public.material_payment_allocations payment
  where payment.financial_transaction_id = transaction.id
    and payment.reversed_at is null
) allocation on true
where transaction.transaction_type = 'expense'
  and not transaction.is_transfer
  and transaction.amount < 0
  and transaction.category in ('Paint & materials', 'Materials');

create or replace view public.project_material_costs
with (security_invoker = true)
as
select
  allocation.companycam_project_id,
  count(distinct invoice.id)::integer as material_invoice_count,
  count(distinct line.id)::integer as material_line_count,
  sum(allocation.allocated_before_tax)::numeric(14, 2) as amount_before_tax,
  sum(allocation.allocated_tax)::numeric(14, 2) as tax_amount,
  sum(allocation.allocated_total)::numeric(14, 2) as total_amount
from public.material_invoice_line_allocations allocation
join public.material_invoice_lines line
  on line.id = allocation.material_invoice_line_id
join public.material_invoices invoice
  on invoice.id = line.material_invoice_id
where allocation.reversed_at is null
  and allocation.allocation_scope = 'job'
group by allocation.companycam_project_id;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'material_invoice_documents',
    'material_invoices',
    'material_invoice_lines',
    'material_invoice_line_allocations',
    'material_payment_allocations'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
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
    execute format('grant select, insert, update on public.%I to authenticated', table_name);
  end loop;
end $$;

grant select on public.material_invoice_verification to authenticated;
grant select on public.material_payment_verification to authenticated;
grant select on public.project_material_costs to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'material_invoice_documents',
    'material_invoices',
    'material_invoice_lines',
    'material_invoice_line_allocations',
    'material_payment_allocations'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_set_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('material-invoices', 'material-invoices', false, 52428800, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Managers can read material invoice files" on storage.objects;
create policy "Managers can read material invoice files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'material-invoices'
    and public.current_employee_role() in ('admin', 'manager')
  );

drop policy if exists "Managers can insert material invoice files" on storage.objects;
create policy "Managers can insert material invoice files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'material-invoices'
    and public.current_employee_role() in ('admin', 'manager')
  );

select pg_notify('pgrst', 'reload schema');

commit;
