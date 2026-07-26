#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const [reconciliationPath, outputPath] = process.argv.slice(2);
if (!reconciliationPath || !outputPath) {
  throw new Error(
    "Usage: node generate-proposal-reconciliation-migration.mjs <reconciliation.json> <migration.sql>",
  );
}

const reconciliation = JSON.parse(
  fs.readFileSync(path.resolve(reconciliationPath), "utf8"),
);

function sqlText(value) {
  if (value == null) return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlTextArray(values) {
  return `array[${values.map(sqlText).join(", ")}]::text[]`;
}

function scoreFor(invoice, link) {
  const current = invoice.currentLinks.find(
    (candidate) => candidate.projectId === link.projectId,
  );
  if (current) return current.matchScore;
  if (
    link.confidence === "explicit_proposal" ||
    link.confidence === "verified_invoice_line"
  ) {
    return 200;
  }
  if (link.confidence === "repeat_name_date") return 175;
  if (link.confidence === "unique_name") return 150;
  return 100;
}

function needsReviewFor(invoice, link) {
  const current = invoice.currentLinks.find(
    (candidate) => candidate.projectId === link.projectId,
  );
  if (
    current &&
    current.allocatedAmount == null &&
    link.allocatedAmount != null
  ) {
    return false;
  }
  if (current && link.confidence.startsWith("existing_link")) {
    return current.needsReview;
  }
  return false;
}

const changedInvoices = reconciliation.changedInvoices;
const linkRows = changedInvoices.flatMap((invoice) =>
  invoice.recommendedLinks.map((link) => ({
    invoiceId: invoice.invoiceId,
    projectId: link.projectId,
    allocatedAmount: link.allocatedAmount,
    matchScore: scoreFor(invoice, link),
    matchMethod: [
      ...link.evidence,
      "proposal_reconciliation_20260726",
    ],
    isPrimary: link.isPrimary,
    needsReview: needsReviewFor(invoice, link),
  })),
);

const changedInvoiceIds = changedInvoices.map((invoice) => invoice.invoiceId);
const linkValues = linkRows
  .map(
    (row) =>
      `  (${sqlText(row.invoiceId)}::uuid, ${sqlText(row.projectId)}, ${
        row.allocatedAmount == null ? "null" : Number(row.allocatedAmount).toFixed(2)
      }::numeric, ${row.matchScore}, ${sqlTextArray(row.matchMethod)}, ${
        row.isPrimary
      }, ${row.needsReview})`,
  )
  .join(",\n");
const changedValues = changedInvoiceIds
  .map((invoiceId) => `  (${sqlText(invoiceId)}::uuid)`)
  .join(",\n");

const sql = `-- Reconcile archived labour invoices to proposal-scoped DripJobs jobs.
--
-- Exact proposal IDs, invoice line amounts, job addresses, and job dates take
-- precedence over customer-name matching. Shared invoice totals are stored as
-- per-job pre-tax allocations so they are counted once and only once.

begin;

-- One proposal ID appears directly on an invoice but was absent from the
-- all-jobs workbook. Keep it proposal-scoped so its invoice is not charged to
-- an unrelated customer job.
insert into public.companycam_projects (
  companycam_id,
  name,
  city,
  state,
  country,
  formatted_address,
  is_archived,
  raw,
  last_synced_at,
  labels,
  is_lead,
  companycam_status,
  is_deleted
)
values
  (
    'dripjobs-1802104',
    'Drywall repair — proposal 1802104',
    'Ottawa',
    'ON',
    'CA',
    null,
    false,
    jsonb_build_object(
      'source', 'labour_invoice_proposal_reconciliation',
      'proposal_id', '1802104',
      'status', 'invoice_verified'
    ),
    timezone('utc', now()),
    jsonb_build_array(jsonb_build_object('name', 'DripJobs invoice-only job')),
    false,
    'dripjobs_invoice_verified',
    false
  )
on conflict (companycam_id) do update
set
  name = excluded.name,
  formatted_address = excluded.formatted_address,
  raw = excluded.raw,
  labels = excluded.labels,
  is_lead = false,
  companycam_status = excluded.companycam_status,
  is_deleted = false,
  updated_at = timezone('utc', now());

insert into public.project_budgets (
  companycam_project_id,
  amount_including_tax,
  labour_allocation_percent,
  notes
)
values
  (
    'dripjobs-1802104',
    null,
    40,
    'Created from verified labour invoice; DripJobs proposal 1802104; customer contract amount unavailable.'
  )
on conflict (companycam_project_id) do update
set
  notes = excluded.notes,
  labour_allocation_percent = excluded.labour_allocation_percent,
  updated_at = timezone('utc', now());

create temporary table _verified_invoice_links (
  invoice_id uuid not null,
  companycam_project_id text not null,
  allocated_amount numeric(12, 2),
  match_score integer not null,
  match_method text[] not null,
  is_primary boolean not null,
  needs_review boolean not null,
  primary key (invoice_id, companycam_project_id)
) on commit drop;

insert into _verified_invoice_links (
  invoice_id,
  companycam_project_id,
  allocated_amount,
  match_score,
  match_method,
  is_primary,
  needs_review
)
values
${linkValues};

create temporary table _changed_invoice_ids (
  invoice_id uuid primary key
) on commit drop;

insert into _changed_invoice_ids (invoice_id)
values
${changedValues};

-- Remove only links superseded by this verified reconciliation.
delete from public.labour_invoice_projects existing
using _changed_invoice_ids changed
where existing.invoice_id = changed.invoice_id
  and not exists (
    select 1
    from _verified_invoice_links verified
    where verified.invoice_id = existing.invoice_id
      and verified.companycam_project_id = existing.companycam_project_id
  );

insert into public.labour_invoice_projects (
  invoice_id,
  companycam_project_id,
  allocated_amount,
  match_score,
  match_method,
  is_primary,
  needs_review
)
select
  verified.invoice_id,
  verified.companycam_project_id,
  verified.allocated_amount,
  verified.match_score,
  verified.match_method,
  verified.is_primary,
  verified.needs_review
from _verified_invoice_links verified
join public.labour_invoices invoice
  on invoice.id = verified.invoice_id
join public.companycam_projects project
  on project.companycam_id = verified.companycam_project_id
on conflict (invoice_id, companycam_project_id) do update
set
  allocated_amount = excluded.allocated_amount,
  match_score = excluded.match_score,
  match_method = excluded.match_method,
  is_primary = excluded.is_primary,
  needs_review = excluded.needs_review,
  updated_at = timezone('utc', now());

-- Invoice 8605 arrived after the original archive download.
insert into public.labour_invoices (
  supplier_name,
  invoice_number,
  invoice_date,
  currency,
  amount_paid,
  amount_before_tax,
  tax_amount,
  payment_basis,
  document_type,
  match_status,
  storage_bucket,
  storage_path,
  original_filename,
  mime_type,
  file_size,
  content_sha256,
  source_date,
  source_label,
  duplicate_group_size,
  text_excerpt
)
values (
  'XDesign Dev Inc',
  '8605',
  date '2026-07-24',
  'CAD',
  237.30,
  210.00,
  27.30,
  'invoice_total',
  'invoice',
  'matched',
  'labour-invoices',
  'gmail-labour-invoices/2026-07-24/c951da032acf73f7-2026-07-24 - Invoice_8605_2026-07-24.pdf',
  '2026-07-24 - Invoice_8605_2026-07-24.pdf',
  'application/pdf',
  80424,
  'c951da032acf73f79a5b76bf13860384cccf8c84430b3c5fa569b0e2555c8f43',
  date '2026-07-24',
  'Gmail / Labour Invoices',
  1,
  'Invoice #8605; Leiya Dobson; 120 Walnut Ct #46; 7 hours at $30; subtotal $210.00; HST $27.30; total $237.30.'
)
on conflict (content_sha256) do update
set
  supplier_name = excluded.supplier_name,
  invoice_number = excluded.invoice_number,
  invoice_date = excluded.invoice_date,
  amount_paid = excluded.amount_paid,
  amount_before_tax = excluded.amount_before_tax,
  tax_amount = excluded.tax_amount,
  match_status = excluded.match_status,
  storage_path = excluded.storage_path,
  original_filename = excluded.original_filename,
  text_excerpt = excluded.text_excerpt,
  updated_at = timezone('utc', now());

insert into public.labour_invoice_projects (
  invoice_id,
  companycam_project_id,
  allocated_amount,
  match_score,
  match_method,
  is_primary,
  needs_review
)
select
  invoice.id,
  '109381573',
  210.00,
  200,
  array[
    'name:leiya dobson',
    'address:120 walnut',
    'verified_invoice_line',
    'proposal_reconciliation_20260726'
  ]::text[],
  true,
  false
from public.labour_invoices invoice
join public.companycam_projects project
  on project.companycam_id = '109381573'
where invoice.content_sha256 =
  'c951da032acf73f79a5b76bf13860384cccf8c84430b3c5fa569b0e2555c8f43'
on conflict (invoice_id, companycam_project_id) do update
set
  allocated_amount = excluded.allocated_amount,
  match_score = excluded.match_score,
  match_method = excluded.match_method,
  is_primary = true,
  needs_review = false,
  updated_at = timezone('utc', now());

-- Recalculate operational match status for the reconciled invoices.
with link_counts as (
  select
    changed.invoice_id,
    count(link.companycam_project_id)::integer as link_count
  from _changed_invoice_ids changed
  left join public.labour_invoice_projects link
    on link.invoice_id = changed.invoice_id
  group by changed.invoice_id
)
update public.labour_invoices invoice
set
  match_status = case
    when invoice.document_type <> 'invoice' then invoice.match_status
    when counts.link_count = 0 then 'unmatched'
    when counts.link_count = 1 then 'matched'
    else 'matched_multiple'
  end,
  updated_at = timezone('utc', now())
from link_counts counts
where invoice.id = counts.invoice_id;

do $audit$
begin
  if exists (
    select 1
    from _verified_invoice_links verified
    join public.labour_invoices invoice
      on invoice.id = verified.invoice_id
    where verified.allocated_amount >
      coalesce(invoice.amount_before_tax, verified.allocated_amount) + 0.01
  ) then
    raise exception 'A reconciled job allocation exceeds its invoice pre-tax total';
  end if;

  if exists (
    select 1
    from (
      values
        ('2025-09-11 - INV-000197.pdf'::text, 10208.00::numeric),
        ('2025-10-20 - INV-000197.pdf'::text, 8098.00::numeric),
        ('2026-03-03 - INV-20260302-001.pdf'::text, 950.00::numeric),
        ('2026-07-11 - Invoice_8597_2026-07-11.pdf'::text, 270.00::numeric),
        ('2026-07-15 - Invoice_1_2026-07-17.pdf'::text, 3690.00::numeric),
        ('2026-07-20 - GT-INV-202607-03-Ottawa-Painters.pdf'::text, 1400.00::numeric),
        ('2026-07-24 - GT-INV-202707-04-Ottawa-Painters.pdf'::text, 2350.00::numeric)
    ) expected(filename, expected_total)
    join public.labour_invoices invoice
      on invoice.original_filename = expected.filename
    left join public.labour_invoice_projects link
      on link.invoice_id = invoice.id
    group by invoice.id, expected.expected_total
    having abs(coalesce(sum(link.allocated_amount), 0) - expected.expected_total) > 0.01
  ) then
    raise exception 'A fully itemized shared invoice does not reconcile to its pre-tax total';
  end if;

  if exists (
    select 1
    from public.labour_invoices invoice
    join public.labour_invoice_projects link
      on link.invoice_id = invoice.id
    where invoice.original_filename in (
      '2026-07-22 - Invoice_8603_2026-07-21.pdf',
      '2026-07-24 - GT-INV-202707-04-Ottawa-Painters.pdf'
    )
      and link.companycam_project_id = 'dripjobs-2663981'
  ) then
    raise exception 'Corey Parsons July invoices were attached to the old April proposal';
  end if;
end
$audit$;

commit;
`;

fs.writeFileSync(path.resolve(outputPath), sql);
console.log(
  JSON.stringify({
    changedInvoices: changedInvoices.length,
    verifiedLinks: linkRows.length,
    outputPath: path.resolve(outputPath),
  }),
);
