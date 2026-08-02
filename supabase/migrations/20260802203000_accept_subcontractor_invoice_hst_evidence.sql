-- A physical subcontractor invoice that itemizes HST is the evidence used by
-- job costing. Registration metadata may still be stored for reference, but
-- it must not put an otherwise reconciled job into Needs review.

begin;

create or replace view public.job_supplier_invoice_reconciliation
with (security_invoker = true)
as
with ranked_invoices as (
  select
    invoice.*,
    row_number() over (
      partition by coalesce(invoice.duplicate_group_id, invoice.id::text)
      order by
        coalesce(invoice.source_date, invoice.invoice_date) desc nulls last,
        coalesce(invoice.amount_paid, 0) desc,
        invoice.id desc
    ) as version_rank
  from public.labour_invoices invoice
  where invoice.document_type = 'invoice'
    and invoice.match_status <> 'supporting_document'
), allocated_lines as (
  select
    allocation.companycam_project_id,
    invoice.id as supplier_invoice_id,
    invoice.contractor_id,
    invoice.supplier_name,
    invoice.invoice_number,
    coalesce(invoice.invoice_date, invoice.source_date) as invoice_date,
    invoice.currency,
    sum(allocation.allocated_amount)::numeric(14,2)
      as allocated_before_hst,
    round(sum(
      case
        when abs(line.amount_before_tax) > 0.005 then
          allocation.allocated_amount * line.tax_amount / line.amount_before_tax
        else 0
      end
    ), 2)::numeric(14,2) as allocated_hst,
    bool_or(line.needs_review or allocation.needs_review) as needs_line_review
  from ranked_invoices invoice
  join public.labour_invoice_lines line
    on line.invoice_id = invoice.id
  join public.labour_invoice_line_allocations allocation
    on allocation.invoice_line_id = line.id
  where invoice.version_rank = 1
  group by
    allocation.companycam_project_id,
    invoice.id,
    invoice.contractor_id,
    invoice.supplier_name,
    invoice.invoice_number,
    coalesce(invoice.invoice_date, invoice.source_date),
    invoice.currency
)
select
  allocated.companycam_project_id,
  identity.job_proposal_id,
  allocated.supplier_invoice_id,
  allocated.contractor_id,
  allocated.supplier_name,
  allocated.invoice_number,
  allocated.invoice_date,
  allocated.currency,
  allocated.allocated_before_hst,
  allocated.allocated_hst,
  (allocated.allocated_before_hst + allocated.allocated_hst)::numeric(14,2)
    as allocated_after_hst,
  verification.payment_status,
  verification.verification_status,
  coalesce(verification.payment_count, 0)::integer as bank_payment_count,
  coalesce(verification.paid_amount, 0)::numeric(14,2)
    as supplier_invoice_paid_amount,
  case
    when verification.payment_status in ('paid', 'overpaid')
      then allocated.allocated_before_hst
    else 0
  end::numeric(14,2) as settled_before_hst,
  case
    when verification.payment_status in ('paid', 'overpaid')
      then allocated.allocated_hst
    else 0
  end::numeric(14,2) as settled_hst,
  coalesce(registration.registration_status, 'unknown')
    as contractor_tax_registration_status,
  registration.registration_number as contractor_tax_registration_number,
  'verified'::text as tax_evidence_status,
  allocated.needs_line_review
from allocated_lines allocated
left join public.job_accounting_identity identity
  on identity.companycam_project_id = allocated.companycam_project_id
left join public.labour_invoice_verification verification
  on verification.invoice_id = allocated.supplier_invoice_id
left join lateral (
  select registration.*
  from public.labour_contractor_tax_registrations registration
  where registration.contractor_id = allocated.contractor_id
    and registration.effective_from <= allocated.invoice_date
    and (
      registration.effective_to is null
      or registration.effective_to >= allocated.invoice_date
    )
  order by registration.effective_from desc, registration.inserted_at desc
  limit 1
) registration on true;

comment on view public.job_supplier_invoice_reconciliation is
  'Job-allocated subcontractor invoice costs; itemized HST on the archived invoice is sufficient tax evidence for job costing.';

comment on table public.labour_contractor_tax_registrations is
  'Optional effective-dated subcontractor GST/HST registration metadata; archived invoice tax remains the job-costing evidence.';

comment on view public.accounting_reconciliation_exceptions is
  'One queue for missing job, invoice, bank, supplier-line, and material-line connections.';

select pg_notify('pgrst', 'reload schema');

commit;
