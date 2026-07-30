-- Generalizes normalized labour invoice lines into browsable invoice entries.
-- The parent labour_invoices row and its private source file remain immutable
-- source evidence. Derived legacy entries are explicitly marked for review.

begin;

alter table public.labour_invoice_lines
  add column if not exists entry_type text not null default 'labour',
  add column if not exists quantity numeric(12, 4),
  add column if not exists unit text,
  add column if not exists unit_price numeric(12, 2),
  add column if not exists tax_amount numeric(12, 2) not null default 0,
  add column if not exists source_reference text;

alter table public.labour_invoice_lines
  drop constraint if exists labour_invoice_lines_entry_type_check;
alter table public.labour_invoice_lines
  add constraint labour_invoice_lines_entry_type_check
  check (
    entry_type in (
      'labour',
      'material',
      'bonus',
      'commission',
      'expense',
      'other',
      'unclassified'
    )
  );

alter table public.labour_invoice_lines
  drop constraint if exists labour_invoice_lines_source_kind_check;
alter table public.labour_invoice_lines
  add constraint labour_invoice_lines_source_kind_check
  check (
    source_kind in (
      'extracted',
      'manual',
      'legacy_project_link',
      'legacy_invoice_total'
    )
  );

alter table public.labour_invoice_lines
  drop constraint if exists labour_invoice_lines_quantity_check;
alter table public.labour_invoice_lines
  add constraint labour_invoice_lines_quantity_check
  check (quantity is null or quantity >= 0);

alter table public.labour_invoice_lines
  drop constraint if exists labour_invoice_lines_unit_price_check;
alter table public.labour_invoice_lines
  add constraint labour_invoice_lines_unit_price_check
  check (unit_price is null or unit_price >= 0);

alter table public.labour_invoice_lines
  drop constraint if exists labour_invoice_lines_tax_amount_check;
alter table public.labour_invoice_lines
  add constraint labour_invoice_lines_tax_amount_check
  check (tax_amount >= 0);

create unique index if not exists labour_invoice_lines_source_reference_key
  on public.labour_invoice_lines(invoice_id, source_reference)
  where source_reference is not null;

create index if not exists labour_invoice_lines_entry_type_idx
  on public.labour_invoice_lines(entry_type, service_started_on desc);

update public.labour_invoice_lines
set
  quantity = coalesce(quantity, quantity_hours),
  unit = coalesce(unit, case when quantity_hours is not null then 'hour' end),
  unit_price = coalesce(unit_price, hourly_rate)
where quantity_hours is not null
  and (quantity is null or unit is null or unit_price is null);

-- Older imports stored reliable job-dollar associations but did not create
-- normalized entries. Each association becomes a derived labour entry. It is
-- marked needs_review because its wording is not an exact invoice extraction.
with invoices_without_entries as (
  select invoice.id
  from public.labour_invoices invoice
  left join public.labour_invoice_lines entry
    on entry.invoice_id = invoice.id
  where invoice.document_type = 'invoice'
  group by invoice.id
  having count(entry.id) = 0
),
ranked_links as (
  select
    link.invoice_id,
    link.companycam_project_id,
    link.allocated_amount,
    link.match_method,
    link.needs_review,
    project.name as project_name,
    project.formatted_address,
    row_number() over (
      partition by link.invoice_id
      order by
        link.is_primary desc,
        link.match_score desc,
        link.companycam_project_id
    ) as line_number
  from public.labour_invoice_projects link
  join invoices_without_entries missing
    on missing.id = link.invoice_id
  left join public.companycam_projects project
    on project.companycam_id = link.companycam_project_id
  where link.allocated_amount is not null
)
insert into public.labour_invoice_lines (
  invoice_id,
  line_number,
  entry_type,
  description,
  amount_before_tax,
  source_kind,
  source_reference,
  source_text,
  needs_review
)
select
  ranked.invoice_id,
  ranked.line_number,
  'labour',
  coalesce(
    nullif(trim(ranked.project_name), ''),
    'Job ' || ranked.companycam_project_id
  ),
  ranked.allocated_amount,
  'legacy_project_link',
  'labour_invoice_project:' || ranked.companycam_project_id,
  concat_ws(
    ' · ',
    'Derived from the archived invoice-to-job allocation',
    nullif(trim(ranked.formatted_address), ''),
    nullif(array_to_string(ranked.match_method, ', '), '')
  ),
  true
from ranked_links ranked
on conflict (invoice_id, source_reference) where source_reference is not null
do nothing;

-- Copy those derived job associations to the normalized entry allocation
-- table so the job relationship is visible from the entry itself.
insert into public.labour_invoice_line_allocations (
  invoice_line_id,
  companycam_project_id,
  allocated_amount,
  allocation_method,
  needs_review
)
select
  entry.id,
  link.companycam_project_id,
  link.allocated_amount,
  array_append(link.match_method, 'legacy_invoice_project_backfill'),
  true
from public.labour_invoice_lines entry
join public.labour_invoice_projects link
  on entry.invoice_id = link.invoice_id
 and entry.source_reference =
   'labour_invoice_project:' || link.companycam_project_id
where entry.source_kind = 'legacy_project_link'
  and link.allocated_amount is not null
on conflict (invoice_line_id, companycam_project_id) do nothing;

-- Any positive amount that is not represented by the job-derived entries is
-- kept as a visible unclassified entry. This catches materials, parking,
-- extras, commissions, and invoices with no job link without guessing what
-- the source document says.
with entry_totals as (
  select
    invoice.id as invoice_id,
    invoice.invoice_number,
    invoice.text_excerpt,
    invoice.amount_before_tax,
    coalesce(sum(entry.amount_before_tax), 0) as represented_amount,
    coalesce(max(entry.line_number), 0) as last_line_number
  from public.labour_invoices invoice
  left join public.labour_invoice_lines entry
    on entry.invoice_id = invoice.id
  where invoice.document_type = 'invoice'
  group by
    invoice.id,
    invoice.invoice_number,
    invoice.text_excerpt,
    invoice.amount_before_tax
)
insert into public.labour_invoice_lines (
  invoice_id,
  line_number,
  entry_type,
  description,
  amount_before_tax,
  source_kind,
  source_reference,
  source_text,
  needs_review
)
select
  totals.invoice_id,
  totals.last_line_number + 1,
  case
    when totals.represented_amount = 0
      and lower(coalesce(totals.text_excerpt, '')) like '%commission%'
      then 'commission'
    else 'unclassified'
  end,
  case
    when totals.represented_amount = 0
      and lower(coalesce(totals.text_excerpt, '')) like '%commission%'
      then 'Commission entry — exact line extraction required'
    when totals.represented_amount = 0
      then 'Invoice entry — exact line extraction required'
    else 'Unallocated invoice remainder — classification required'
  end,
  round(totals.amount_before_tax - totals.represented_amount, 2),
  'legacy_invoice_total',
  'labour_invoice_total_remainder',
  'Amount is the archived invoice pre-tax total less normalized entries. Open the original invoice to classify and split it.',
  true
from entry_totals totals
where totals.amount_before_tax - totals.represented_amount > 0.005
on conflict (invoice_id, source_reference) where source_reference is not null
do nothing;

create or replace view public.invoice_entries
with (security_invoker = true)
as
select
  entry.id,
  entry.invoice_id,
  entry.line_number as entry_number,
  entry.entry_type,
  entry.description,
  entry.service_started_on,
  entry.service_ended_on,
  entry.quantity,
  entry.unit,
  entry.unit_price,
  entry.quantity_hours,
  entry.hourly_rate,
  entry.amount_before_tax,
  entry.tax_amount,
  entry.is_adjustment,
  entry.source_kind,
  entry.source_reference,
  entry.source_text,
  entry.needs_review,
  entry.inserted_by,
  entry.inserted_at,
  entry.updated_at
from public.labour_invoice_lines entry;

revoke all on public.invoice_entries from anon;
grant select on public.invoice_entries to authenticated;

comment on view public.invoice_entries is
  'Generic browsable invoice entries backed by normalized labour_invoice_lines. Parent labour_invoices rows preserve source documents.';
comment on column public.labour_invoice_lines.entry_type is
  'Business classification for filtering: labour, material, bonus, commission, expense, other, or unclassified.';
comment on column public.labour_invoice_lines.source_kind is
  'Evidence grade: exact extraction/manual entry, a legacy job allocation, or an invoice-total placeholder.';
comment on column public.labour_invoice_lines.source_reference is
  'Stable identifier for the source relationship used to create a derived entry.';

commit;
