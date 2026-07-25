-- Private source-document archive for labour invoices. This is intentionally
-- separate from project_labour_expenses so uploaded documents do not
-- automatically change labour-cost metrics.

create table if not exists public.labour_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null check (length(trim(supplier_name)) > 0),
  invoice_number text not null check (length(trim(invoice_number)) > 0),
  invoice_date date,
  currency text not null default 'CAD'
    check (currency in ('CAD', 'USD')),
  amount_paid numeric(12, 2)
    check (amount_paid is null or amount_paid >= 0),
  amount_before_tax numeric(12, 2)
    check (amount_before_tax is null or amount_before_tax >= 0),
  tax_amount numeric(12, 2)
    check (tax_amount is null or tax_amount >= 0),
  payment_basis text not null default 'invoice_total'
    check (payment_basis in ('invoice_total', 'explicit_payment')),
  document_type text not null
    check (
      document_type in (
        'invoice',
        'payment_receipt',
        'receipt',
        'needs_review',
        'not_invoice'
      )
    ),
  match_status text not null
    check (
      match_status in (
        'matched',
        'matched_multiple',
        'unmatched',
        'overhead_unmatched',
        'supporting_document',
        'not_invoice'
      )
    ),
  storage_bucket text not null default 'labour-invoices',
  storage_path text not null unique,
  original_filename text not null check (length(trim(original_filename)) > 0),
  mime_type text not null check (length(trim(mime_type)) > 0),
  file_size bigint not null check (file_size > 0),
  content_sha256 text not null unique
    check (content_sha256 ~ '^[0-9a-f]{64}$'),
  source_date date,
  source_label text not null default 'Gmail / Labour Invoices',
  duplicate_group_id text,
  duplicate_group_size integer not null default 1
    check (duplicate_group_size >= 1),
  supporting_invoice_reference text,
  text_excerpt text,
  inserted_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.labour_invoice_projects (
  invoice_id uuid not null
    references public.labour_invoices(id) on update cascade on delete cascade,
  companycam_project_id text not null
    references public.companycam_projects(companycam_id) on update cascade on delete restrict,
  allocated_amount numeric(12, 2)
    check (allocated_amount is null or allocated_amount >= 0),
  match_score integer not null check (match_score between 0 and 500),
  match_method text[] not null default '{}',
  is_primary boolean not null default false,
  needs_review boolean not null default false,
  inserted_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (invoice_id, companycam_project_id)
);

create index if not exists labour_invoices_date_idx
  on public.labour_invoices(invoice_date desc, supplier_name);

create index if not exists labour_invoices_match_status_idx
  on public.labour_invoices(match_status, invoice_date desc);

create index if not exists labour_invoices_duplicate_group_idx
  on public.labour_invoices(duplicate_group_id)
  where duplicate_group_id is not null;

create index if not exists labour_invoice_projects_project_idx
  on public.labour_invoice_projects(companycam_project_id, invoice_id);

drop trigger if exists set_labour_invoices_updated_at on public.labour_invoices;
create trigger set_labour_invoices_updated_at
before update on public.labour_invoices
for each row execute function public.set_updated_at();

drop trigger if exists set_labour_invoice_projects_updated_at on public.labour_invoice_projects;
create trigger set_labour_invoice_projects_updated_at
before update on public.labour_invoice_projects
for each row execute function public.set_updated_at();

alter table public.labour_invoices enable row level security;
alter table public.labour_invoice_projects enable row level security;

drop policy if exists "Managers can read labour invoice archive" on public.labour_invoices;
create policy "Managers can read labour invoice archive"
on public.labour_invoices
for select
to authenticated
using (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can insert labour invoice archive" on public.labour_invoices;
create policy "Managers can insert labour invoice archive"
on public.labour_invoices
for insert
to authenticated
with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can update labour invoice archive" on public.labour_invoices;
create policy "Managers can update labour invoice archive"
on public.labour_invoices
for update
to authenticated
using (public.current_employee_role() in ('admin', 'manager'))
with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Admins can delete labour invoice archive" on public.labour_invoices;
create policy "Admins can delete labour invoice archive"
on public.labour_invoices
for delete
to authenticated
using (public.current_employee_role() = 'admin');

drop policy if exists "Managers can read labour invoice project links" on public.labour_invoice_projects;
create policy "Managers can read labour invoice project links"
on public.labour_invoice_projects
for select
to authenticated
using (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can insert labour invoice project links" on public.labour_invoice_projects;
create policy "Managers can insert labour invoice project links"
on public.labour_invoice_projects
for insert
to authenticated
with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can update labour invoice project links" on public.labour_invoice_projects;
create policy "Managers can update labour invoice project links"
on public.labour_invoice_projects
for update
to authenticated
using (public.current_employee_role() in ('admin', 'manager'))
with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Admins can delete labour invoice project links" on public.labour_invoice_projects;
create policy "Admins can delete labour invoice project links"
on public.labour_invoice_projects
for delete
to authenticated
using (public.current_employee_role() = 'admin');

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'labour-invoices',
  'labour-invoices',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'message/rfc822',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Managers can read labour invoice files" on storage.objects;
create policy "Managers can read labour invoice files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'labour-invoices'
  and public.current_employee_role() in ('admin', 'manager')
);

drop policy if exists "Managers can upload labour invoice files" on storage.objects;
create policy "Managers can upload labour invoice files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'labour-invoices'
  and public.current_employee_role() in ('admin', 'manager')
);

drop policy if exists "Managers can update labour invoice files" on storage.objects;
create policy "Managers can update labour invoice files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'labour-invoices'
  and public.current_employee_role() in ('admin', 'manager')
)
with check (
  bucket_id = 'labour-invoices'
  and public.current_employee_role() in ('admin', 'manager')
);

drop policy if exists "Admins can delete labour invoice files" on storage.objects;
create policy "Admins can delete labour invoice files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'labour-invoices'
  and public.current_employee_role() = 'admin'
);

comment on table public.labour_invoices is
  'Private audit archive for source labour-invoice documents. Records do not affect labour metrics unless separately entered in project_labour_expenses.';

comment on column public.labour_invoices.amount_paid is
  'Gross amount recorded on the source document, including tax when applicable.';

comment on table public.labour_invoice_projects is
  'Auditable links between archived source documents and one or more CompanyCam projects.';
