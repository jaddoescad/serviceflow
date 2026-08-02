-- Preserve voided customer invoices as source evidence while excluding them
-- from active revenue, receivables, marketing attribution, and job accounting.

begin;

alter table public.customer_invoices
  add column if not exists accounting_status text not null default 'active',
  add column if not exists superseded_by_invoice_id uuid
    references public.customer_invoices(id) on delete restrict,
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.customer_invoices'::regclass
      and conname = 'customer_invoices_accounting_status_check'
  ) then
    alter table public.customer_invoices
      add constraint customer_invoices_accounting_status_check
      check (accounting_status in ('active', 'void'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.customer_invoices'::regclass
      and conname = 'customer_invoices_void_evidence_check'
  ) then
    alter table public.customer_invoices
      add constraint customer_invoices_void_evidence_check
      check (
        (
          accounting_status = 'active'
          and voided_at is null
        )
        or (
          accounting_status = 'void'
          and voided_at is not null
          and length(trim(coalesce(void_reason, ''))) > 0
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.customer_invoices'::regclass
      and conname = 'customer_invoices_not_self_superseded_check'
  ) then
    alter table public.customer_invoices
      add constraint customer_invoices_not_self_superseded_check
      check (superseded_by_invoice_id is null or superseded_by_invoice_id <> id);
  end if;
end;
$$;

create index if not exists customer_invoices_active_project_idx
  on public.customer_invoices(companycam_project_id, invoice_date)
  where accounting_status = 'active';

alter table public.dripjobs_jobs
  add column if not exists accounting_status text not null default 'active',
  add column if not exists superseded_by_proposal_id text
    references public.dripjobs_jobs(proposal_id) on delete restrict,
  add column if not exists accounting_note text,
  add column if not exists accounting_status_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.dripjobs_jobs'::regclass
      and conname = 'dripjobs_jobs_accounting_status_check'
  ) then
    alter table public.dripjobs_jobs
      add constraint dripjobs_jobs_accounting_status_check
      check (accounting_status in ('active', 'superseded', 'excluded'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.dripjobs_jobs'::regclass
      and conname = 'dripjobs_jobs_supersession_check'
  ) then
    alter table public.dripjobs_jobs
      add constraint dripjobs_jobs_supersession_check
      check (
        (
          accounting_status = 'active'
          and superseded_by_proposal_id is null
        )
        or (
          accounting_status = 'superseded'
          and superseded_by_proposal_id is not null
          and superseded_by_proposal_id <> proposal_id
        )
        or accounting_status = 'excluded'
      );
  end if;
end;
$$;

create index if not exists dripjobs_jobs_active_accounting_idx
  on public.dripjobs_jobs(proposal_id)
  where accounting_status = 'active';

create or replace function public.validate_customer_revenue_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  transaction_row public.financial_transactions%rowtype;
  invoice_row public.customer_invoices%rowtype;
  payment_row public.customer_invoice_payment_events%rowtype;
begin
  new.invoice_applied_amount := coalesce(
    new.invoice_applied_amount,
    new.allocated_amount
  );

  if new.reversed_at is not null then
    return new;
  end if;

  select * into transaction_row
  from public.financial_transactions
  where id = new.financial_transaction_id;

  if transaction_row.id is null then
    raise exception 'Financial transaction % does not exist', new.financial_transaction_id;
  end if;
  if transaction_row.amount <= 0
     or transaction_row.transaction_type <> 'income'
     or transaction_row.is_transfer then
    raise exception 'Customer revenue allocations require a positive, non-transfer income transaction';
  end if;
  if transaction_row.category <> 'Painting revenue' then
    raise exception 'Customer revenue allocations require Painting revenue category';
  end if;

  select * into invoice_row
  from public.customer_invoices
  where id = new.customer_invoice_id;

  if invoice_row.id is null then
    raise exception 'Customer invoice % does not exist', new.customer_invoice_id;
  end if;
  if invoice_row.accounting_status <> 'active' then
    raise exception 'Customer revenue allocations require an active invoice';
  end if;
  if transaction_row.currency <> invoice_row.currency then
    raise exception 'Currency mismatch between transaction and invoice';
  end if;

  if new.source_payment_event_id is not null then
    select * into payment_row
    from public.customer_invoice_payment_events
    where id = new.source_payment_event_id;
    if payment_row.id is null or payment_row.customer_invoice_id <> new.customer_invoice_id then
      raise exception 'Source payment event must belong to the allocated invoice';
    end if;
    if payment_row.currency <> invoice_row.currency then
      raise exception 'Currency mismatch between source payment and invoice';
    end if;
  end if;

  return new;
end;
$$;

create or replace view public.job_accounting_identity
with (security_invoker = true)
as
select
  job.proposal_id as job_proposal_id,
  job.job_name,
  job.status as job_status,
  job.proposal_signed_on,
  job.job_start_on,
  job.job_completion_on,
  job.salesperson,
  lead_link.lead_deal_id,
  lead.created_on as lead_created_on,
  lead.normalized_channel as lead_channel,
  lead.raw_lead_source,
  case
    when invoice_identity.project_count = 1
      then invoice_identity.companycam_project_id
    else null
  end as companycam_project_id,
  coalesce(invoice_identity.invoice_count, 0)::integer as customer_invoice_count,
  coalesce(invoice_identity.project_count, 0)::integer as project_identity_count,
  coalesce(invoice_identity.project_count, 0) > 1
    as has_ambiguous_project_identity
from public.dripjobs_jobs job
left join public.marketing_lead_job_links lead_link
  on lead_link.job_proposal_id = job.proposal_id
 and lead_link.relationship_type = 'originated'
 and lead_link.link_status = 'confirmed'
left join public.marketing_leads lead
  on lead.deal_id = lead_link.lead_deal_id
left join lateral (
  select
    count(*) as invoice_count,
    count(distinct invoice.companycam_project_id)
      filter (where invoice.companycam_project_id is not null) as project_count,
    min(invoice.companycam_project_id) as companycam_project_id
  from public.customer_invoices invoice
  where trim(coalesce(invoice.external_proposal_id, '')) = job.proposal_id
    and invoice.accounting_status = 'active'
) invoice_identity on true
where job.accounting_status = 'active';

create or replace view public.job_customer_invoice_reconciliation
with (security_invoker = true)
as
select
  invoice.id as customer_invoice_id,
  invoice.external_proposal_id as job_proposal_id,
  identity.lead_deal_id,
  identity.lead_created_on,
  identity.lead_channel,
  identity.raw_lead_source,
  invoice.companycam_project_id,
  identity.job_name,
  invoice.invoice_number,
  invoice.invoice_date,
  invoice.customer_name,
  invoice.currency,
  invoice.subtotal::numeric(14,2) as billed_before_hst,
  invoice.tax_amount::numeric(14,2) as billed_hst,
  invoice.total_amount::numeric(14,2) as billed_after_hst,
  coalesce(verification.bank_paid_amount, 0)::numeric(14,2)
    as invoice_credited_after_hst,
  case
    when invoice.total_amount > 0 then round(
      coalesce(verification.bank_paid_amount, 0)
        * invoice.subtotal / invoice.total_amount,
      2
    )
    else 0
  end::numeric(14,2) as invoice_credited_before_hst,
  case
    when invoice.total_amount > 0 then round(
      coalesce(verification.bank_paid_amount, 0)
        * invoice.tax_amount / invoice.total_amount,
      2
    )
    else 0
  end::numeric(14,2) as invoice_credited_hst,
  coalesce(verification.bank_cash_amount, 0)::numeric(14,2)
    as bank_cash_received,
  coalesce(verification.processing_fee_amount, 0)::numeric(14,2)
    as processing_fee_amount,
  greatest(coalesce(verification.amount_remaining, invoice.total_amount), 0)
    ::numeric(14,2) as amount_receivable,
  coalesce(verification.bank_payment_count, 0)::integer as bank_payment_count,
  coalesce(verification.bank_payment_status, 'unpaid') as payment_status,
  coalesce(verification.verification_status, 'needs_information')
    as verification_status,
  case
    when trim(coalesce(invoice.external_proposal_id, '')) = ''
      then 'needs_job'
    when identity.job_proposal_id is null
      then 'job_not_found'
    when identity.lead_deal_id is null
      then 'needs_lead'
    when coalesce(verification.verification_status, 'needs_information')
      <> 'verified'
      then 'needs_invoice_review'
    else 'connected'
  end as connection_status
from public.customer_invoices invoice
left join public.job_accounting_identity identity
  on identity.job_proposal_id = trim(coalesce(invoice.external_proposal_id, ''))
left join public.customer_invoice_verification verification
  on verification.customer_invoice_id = invoice.id
where invoice.accounting_status = 'active';

create or replace view public.customer_invoice_marketing_attribution
with (security_invoker = true)
as
select
  invoice.id as customer_invoice_id,
  invoice.external_proposal_id,
  invoice.external_proposal_uuid,
  invoice.companycam_project_id,
  invoice.invoice_date,
  invoice.subtotal as booked_revenue_before_hst,
  invoice.tax_amount as booked_hst,
  invoice.total_amount as booked_revenue_after_hst,
  attribution.external_contact_id,
  attribution.raw_lead_source,
  attribution.normalized_channel,
  attribution.lead_created_at,
  attribution.evidence_source,
  attribution.evidence_reference,
  coalesce(payment.bank_cash_amount, 0)::numeric(14,2) as bank_cash_amount,
  coalesce(payment.invoice_applied_amount, 0)::numeric(14,2)
    as invoice_applied_amount,
  case
    when invoice.total_amount > 0 then round(
      coalesce(payment.invoice_applied_amount, 0)
        * invoice.subtotal / invoice.total_amount,
      2
    )
    else 0
  end::numeric(14,2) as bank_backed_revenue_before_hst
from public.customer_invoices invoice
join public.customer_invoice_acquisition_attributions attribution
  on attribution.customer_invoice_id = invoice.id
left join lateral (
  select
    sum(allocation.allocated_amount) as bank_cash_amount,
    sum(allocation.invoice_applied_amount) as invoice_applied_amount
  from public.customer_invoice_bank_allocations allocation
  where allocation.customer_invoice_id = invoice.id
    and allocation.reversed_at is null
) payment on true
where invoice.accounting_status = 'active';

commit;
