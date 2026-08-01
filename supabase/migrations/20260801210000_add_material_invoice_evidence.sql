begin;

-- The supplier portal exports invoice indexes as CSV. Preserve those exports
-- beside the physical PDFs so a portal row can corroborate an invoice without
-- pretending that the CSV contains product lines.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/html',
  'text/csv'
]::text[]
where id = 'material-invoices';

create table if not exists public.material_invoice_evidence_links (
  id uuid primary key default gen_random_uuid(),
  material_invoice_id uuid not null
    references public.material_invoices(id) on delete restrict,
  document_id uuid not null
    references public.material_invoice_documents(id) on delete restrict,
  evidence_role text not null,
  source_page_start integer,
  source_page_end integer,
  evidence_label text not null,
  source_payload jsonb not null default '{}'::jsonb,
  inserted_at timestamptz not null default now(),
  inserted_by uuid references auth.users(id),
  constraint material_invoice_evidence_links_role_check
    check (evidence_role in ('primary_invoice', 'supporting_batch', 'portal_export')),
  constraint material_invoice_evidence_links_pages_check
    check (
      (source_page_start is null and source_page_end is null)
      or (
        source_page_start is not null
        and source_page_end is not null
        and source_page_start > 0
        and source_page_end >= source_page_start
      )
    ),
  constraint material_invoice_evidence_links_unique
    unique (material_invoice_id, document_id, evidence_role)
);

create unique index if not exists material_invoice_evidence_links_primary_unique
  on public.material_invoice_evidence_links(material_invoice_id)
  where evidence_role = 'primary_invoice';
create index if not exists material_invoice_evidence_links_invoice_idx
  on public.material_invoice_evidence_links(material_invoice_id, evidence_role);
create index if not exists material_invoice_evidence_links_document_idx
  on public.material_invoice_evidence_links(document_id);

create table if not exists public.material_supplier_portal_records (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null
    references public.material_invoice_documents(id) on delete restrict,
  supplier_name text not null,
  account_number text not null,
  store_number text not null,
  invoice_number text not null,
  invoice_number_normalized text not null,
  transaction_date date not null,
  job_account text,
  total_amount numeric(14, 2) not null,
  po_number text,
  portal_type text not null,
  unit_number text,
  extended_invoice boolean not null default false,
  source_row_number integer not null,
  material_invoice_id uuid
    references public.material_invoices(id) on delete restrict,
  match_status text not null,
  match_differences jsonb not null default '[]'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  inserted_at timestamptz not null default now(),
  inserted_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint material_supplier_portal_records_type_check
    check (portal_type in ('invoice', 'correction', 'return')),
  constraint material_supplier_portal_records_match_check
    check (match_status in ('matched', 'matched_with_difference', 'source_missing')),
  constraint material_supplier_portal_records_source_row_check
    check (source_row_number > 1),
  constraint material_supplier_portal_records_link_check
    check (
      (match_status = 'source_missing' and material_invoice_id is null)
      or
      (match_status in ('matched', 'matched_with_difference') and material_invoice_id is not null)
    ),
  constraint material_supplier_portal_records_identity_unique
    unique (
      supplier_name,
      account_number,
      store_number,
      invoice_number_normalized,
      transaction_date
    )
);

create index if not exists material_supplier_portal_records_invoice_idx
  on public.material_supplier_portal_records(material_invoice_id)
  where material_invoice_id is not null;
create index if not exists material_supplier_portal_records_status_idx
  on public.material_supplier_portal_records(match_status, transaction_date desc);

drop trigger if exists material_supplier_portal_records_set_updated_at
  on public.material_supplier_portal_records;
create trigger material_supplier_portal_records_set_updated_at
before update on public.material_supplier_portal_records
for each row execute function public.set_updated_at();

alter table public.material_invoice_evidence_links enable row level security;
alter table public.material_supplier_portal_records enable row level security;

drop policy if exists "Managers can read material invoice evidence links"
  on public.material_invoice_evidence_links;
create policy "Managers can read material invoice evidence links"
  on public.material_invoice_evidence_links for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can read material supplier portal records"
  on public.material_supplier_portal_records;
create policy "Managers can read material supplier portal records"
  on public.material_supplier_portal_records for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));

grant select on public.material_invoice_evidence_links to authenticated;
grant select on public.material_supplier_portal_records to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
