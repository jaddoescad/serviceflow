-- One auditable accounting graph shared by Jobs, Marketing, and Financials.
--
-- Source ownership remains explicit:
--   DripJobs proposal          -> job identity
--   originating lead link      -> acquisition attribution
--   customer invoice           -> revenue and HST billed
--   customer bank allocation   -> cash received and invoice settlement
--   supplier invoice line      -> direct job cost and input HST documented
--   supplier bank allocation   -> cash paid and supplier settlement

begin;

create extension if not exists pgcrypto;

create table if not exists public.labour_contractor_tax_registrations (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null
    references public.labour_contractors(id) on delete restrict,
  registration_status text not null default 'unknown',
  registration_number text,
  effective_from date not null,
  effective_to date,
  evidence_source text not null,
  evidence_reference text not null,
  evidence_note text,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint labour_contractor_tax_registration_unique
    unique (contractor_id, effective_from),
  constraint labour_contractor_tax_registration_status_check check (
    registration_status in ('registered', 'not_registered', 'unknown')
  ),
  constraint labour_contractor_tax_registration_dates_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint labour_contractor_tax_registration_evidence_check check (
    length(trim(evidence_source)) > 0
    and length(trim(evidence_reference)) > 0
  )
);

create index if not exists labour_contractor_tax_registration_lookup_idx
  on public.labour_contractor_tax_registrations(
    contractor_id,
    effective_from desc,
    effective_to
  );

create index if not exists customer_invoices_external_proposal_idx
  on public.customer_invoices(external_proposal_id)
  where external_proposal_id is not null;

drop trigger if exists labour_contractor_tax_registrations_set_updated_at
  on public.labour_contractor_tax_registrations;
create trigger labour_contractor_tax_registrations_set_updated_at
before update on public.labour_contractor_tax_registrations
for each row execute function public.set_updated_at();

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
) invoice_identity on true;

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
  on verification.customer_invoice_id = invoice.id;

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
  case
    when allocated.allocated_hst > 0.005
      and coalesce(registration.registration_status, 'unknown') <> 'registered'
      then 'needs_registration_evidence'
    else 'verified'
  end as tax_evidence_status,
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

create or replace view public.job_material_invoice_reconciliation
with (security_invoker = true)
as
select
  allocation.companycam_project_id,
  identity.job_proposal_id,
  invoice.id as material_invoice_id,
  invoice.supplier_name,
  invoice.invoice_number,
  invoice.invoice_date,
  invoice.currency,
  sum(allocation.allocated_before_tax)::numeric(14,2)
    as allocated_before_hst,
  sum(allocation.allocated_tax)::numeric(14,2) as allocated_hst,
  sum(allocation.allocated_total)::numeric(14,2) as allocated_after_hst,
  verification.verification_status,
  coalesce(verification.payment_count, 0)::integer as bank_payment_count,
  coalesce(verification.paid_amount, 0)::numeric(14,2)
    as material_invoice_paid_amount,
  case
    when coalesce(verification.amount_remaining, invoice.total_amount) <= 0.005
      then sum(allocation.allocated_before_tax)
    else 0
  end::numeric(14,2) as settled_before_hst,
  case
    when coalesce(verification.amount_remaining, invoice.total_amount) <= 0.005
      then sum(allocation.allocated_tax)
    else 0
  end::numeric(14,2) as settled_hst,
  bool_or(allocation.needs_review) as needs_line_review
from public.material_invoice_line_allocations allocation
join public.material_invoice_lines line
  on line.id = allocation.material_invoice_line_id
join public.material_invoices invoice
  on invoice.id = line.material_invoice_id
left join public.job_accounting_identity identity
  on identity.companycam_project_id = allocation.companycam_project_id
left join public.material_invoice_verification verification
  on verification.material_invoice_id = invoice.id
where allocation.reversed_at is null
  and allocation.allocation_scope = 'job'
group by
  allocation.companycam_project_id,
  identity.job_proposal_id,
  invoice.id,
  invoice.supplier_name,
  invoice.invoice_number,
  invoice.invoice_date,
  invoice.currency,
  verification.verification_status,
  verification.payment_count,
  verification.paid_amount,
  verification.amount_remaining;

create or replace view public.job_accounting_reconciliation
with (security_invoker = true)
as
with customer as (
  select
    invoice.job_proposal_id,
    count(*)::integer as invoice_count,
    sum(invoice.billed_before_hst)::numeric(14,2) as billed_before_hst,
    sum(invoice.billed_hst)::numeric(14,2) as billed_hst,
    sum(invoice.billed_after_hst)::numeric(14,2) as billed_after_hst,
    sum(invoice.invoice_credited_before_hst)::numeric(14,2)
      as credited_before_hst,
    sum(invoice.invoice_credited_hst)::numeric(14,2) as credited_hst,
    sum(invoice.invoice_credited_after_hst)::numeric(14,2)
      as credited_after_hst,
    sum(invoice.bank_cash_received)::numeric(14,2) as bank_cash_received,
    sum(invoice.processing_fee_amount)::numeric(14,2) as processing_fees,
    sum(invoice.amount_receivable)::numeric(14,2) as amount_receivable,
    sum(invoice.bank_payment_count)::integer as bank_payment_count,
    bool_or(invoice.verification_status <> 'verified') as needs_invoice_review
  from public.job_customer_invoice_reconciliation invoice
  where invoice.job_proposal_id is not null
  group by invoice.job_proposal_id
), supplier as (
  select
    invoice.job_proposal_id,
    count(distinct invoice.supplier_invoice_id)::integer as invoice_count,
    sum(invoice.allocated_before_hst)::numeric(14,2) as cost_before_hst,
    sum(invoice.allocated_hst)::numeric(14,2) as cost_hst,
    sum(invoice.allocated_after_hst)::numeric(14,2) as cost_after_hst,
    sum(invoice.settled_before_hst)::numeric(14,2) as settled_before_hst,
    sum(invoice.settled_hst)::numeric(14,2) as settled_hst,
    count(*) filter (
      where invoice.payment_status not in ('paid', 'overpaid')
    )::integer as unsettled_invoice_count,
    count(*) filter (
      where invoice.tax_evidence_status <> 'verified'
    )::integer as tax_review_count,
    sum(invoice.allocated_hst) filter (
      where invoice.tax_evidence_status <> 'verified'
    )::numeric(14,2) as unverified_hst,
    bool_or(invoice.needs_line_review) as needs_line_review
  from public.job_supplier_invoice_reconciliation invoice
  where invoice.job_proposal_id is not null
  group by invoice.job_proposal_id
), material as (
  select
    invoice.job_proposal_id,
    count(distinct invoice.material_invoice_id)::integer as invoice_count,
    sum(invoice.allocated_before_hst)::numeric(14,2) as cost_before_hst,
    sum(invoice.allocated_hst)::numeric(14,2) as cost_hst,
    sum(invoice.allocated_after_hst)::numeric(14,2) as cost_after_hst,
    sum(invoice.settled_before_hst)::numeric(14,2) as settled_before_hst,
    sum(invoice.settled_hst)::numeric(14,2) as settled_hst,
    count(*) filter (
      where invoice.settled_before_hst + 0.005 < invoice.allocated_before_hst
    )::integer as unsettled_invoice_count,
    bool_or(invoice.needs_line_review) as needs_line_review
  from public.job_material_invoice_reconciliation invoice
  where invoice.job_proposal_id is not null
  group by invoice.job_proposal_id
)
select
  identity.job_proposal_id,
  identity.companycam_project_id,
  identity.job_name,
  identity.job_status,
  identity.proposal_signed_on,
  identity.job_start_on,
  identity.job_completion_on,
  identity.salesperson,
  identity.lead_deal_id,
  identity.lead_created_on,
  identity.lead_channel,
  identity.raw_lead_source,
  coalesce(customer.invoice_count, 0)::integer as customer_invoice_count,
  coalesce(customer.billed_before_hst, 0)::numeric(14,2)
    as booked_revenue_before_hst,
  coalesce(customer.billed_hst, 0)::numeric(14,2) as customer_hst_billed,
  coalesce(customer.billed_after_hst, 0)::numeric(14,2)
    as customer_invoice_total,
  coalesce(customer.credited_before_hst, 0)::numeric(14,2)
    as bank_backed_revenue_before_hst,
  coalesce(customer.credited_hst, 0)::numeric(14,2)
    as customer_hst_credited,
  coalesce(customer.credited_after_hst, 0)::numeric(14,2)
    as customer_invoice_credited,
  coalesce(customer.bank_cash_received, 0)::numeric(14,2)
    as customer_bank_cash_received,
  coalesce(customer.processing_fees, 0)::numeric(14,2)
    as customer_processing_fees,
  coalesce(customer.amount_receivable, 0)::numeric(14,2)
    as customer_amount_receivable,
  coalesce(customer.bank_payment_count, 0)::integer
    as customer_bank_payment_count,
  coalesce(supplier.invoice_count, 0)::integer as supplier_invoice_count,
  coalesce(supplier.cost_before_hst, 0)::numeric(14,2)
    as supplier_cost_before_hst,
  coalesce(supplier.cost_hst, 0)::numeric(14,2) as supplier_hst_documented,
  coalesce(supplier.cost_after_hst, 0)::numeric(14,2)
    as supplier_cost_after_hst,
  coalesce(supplier.settled_before_hst, 0)::numeric(14,2)
    as settled_supplier_cost_before_hst,
  coalesce(supplier.settled_hst, 0)::numeric(14,2)
    as settled_supplier_hst,
  coalesce(supplier.unsettled_invoice_count, 0)::integer
    as unsettled_supplier_invoice_count,
  coalesce(supplier.tax_review_count, 0)::integer
    as supplier_tax_review_count,
  coalesce(supplier.unverified_hst, 0)::numeric(14,2)
    as supplier_hst_needing_registration_evidence,
  coalesce(material.invoice_count, 0)::integer as material_invoice_count,
  coalesce(material.cost_before_hst, 0)::numeric(14,2)
    as material_cost_before_hst,
  coalesce(material.cost_hst, 0)::numeric(14,2) as material_hst_documented,
  coalesce(material.cost_after_hst, 0)::numeric(14,2)
    as material_cost_after_hst,
  coalesce(material.settled_before_hst, 0)::numeric(14,2)
    as settled_material_cost_before_hst,
  coalesce(material.settled_hst, 0)::numeric(14,2)
    as settled_material_hst,
  coalesce(material.unsettled_invoice_count, 0)::integer
    as unsettled_material_invoice_count,
  (
    coalesce(supplier.cost_before_hst, 0)
    + coalesce(material.cost_before_hst, 0)
  )::numeric(14,2) as direct_cost_before_hst,
  (
    coalesce(supplier.cost_hst, 0)
    + coalesce(material.cost_hst, 0)
  )::numeric(14,2) as direct_cost_hst_documented,
  (
    coalesce(customer.billed_before_hst, 0)
    - coalesce(supplier.cost_before_hst, 0)
    - coalesce(material.cost_before_hst, 0)
  )::numeric(14,2) as gross_profit_before_hst,
  case
    when coalesce(customer.billed_before_hst, 0) > 0 then round(
      (
        customer.billed_before_hst
        - coalesce(supplier.cost_before_hst, 0)
        - coalesce(material.cost_before_hst, 0)
      ) / customer.billed_before_hst,
      4
    )
    else null
  end as gross_margin,
  array_remove(array[
    case when identity.lead_deal_id is null then 'missing_lead' end,
    case when coalesce(customer.invoice_count, 0) = 0
      then 'missing_customer_invoice' end,
    case when identity.has_ambiguous_project_identity
      then 'ambiguous_project_identity' end,
    case when coalesce(customer.needs_invoice_review, false)
      then 'customer_invoice_needs_review' end,
    case when coalesce(supplier.tax_review_count, 0) > 0
      then 'supplier_hst_registration_unverified' end,
    case when coalesce(supplier.needs_line_review, false)
      then 'supplier_cost_needs_review' end,
    case when coalesce(material.needs_line_review, false)
      then 'material_cost_needs_review' end
  ], null)::text[] as review_reasons,
  array_remove(array[
    case when coalesce(customer.amount_receivable, 0) > 0.005
      then 'customer_payment_open' end,
    case when coalesce(supplier.unsettled_invoice_count, 0) > 0
      then 'supplier_payment_open' end,
    case when coalesce(material.unsettled_invoice_count, 0) > 0
      then 'material_payment_open' end
  ], null)::text[] as open_items
from public.job_accounting_identity identity
left join customer on customer.job_proposal_id = identity.job_proposal_id
left join supplier on supplier.job_proposal_id = identity.job_proposal_id
left join material on material.job_proposal_id = identity.job_proposal_id;

create or replace view public.accounting_reconciliation_exceptions
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
)
select
  'job:' || job.job_proposal_id as exception_key,
  'job'::text as exception_scope,
  job.job_proposal_id,
  job.companycam_project_id,
  'dripjobs_job'::text as source_type,
  job.job_proposal_id as source_id,
  null::numeric(14,2) as amount,
  array_to_string(job.review_reasons, ', ') as reason,
  'needs_review'::text as resolution_status
from public.job_accounting_reconciliation job
where cardinality(job.review_reasons) > 0

union all

select
  'bank-income:' || transaction.id,
  'bank_transaction',
  null,
  null,
  'financial_transaction',
  transaction.id::text,
  greatest(
    transaction.amount - coalesce(allocation.allocated_amount, 0),
    0
  )::numeric(14,2),
  'Customer bank income is not fully allocated to an invoice',
  'needs_review'
from public.financial_transactions transaction
left join lateral (
  select sum(allocation.allocated_amount) as allocated_amount
  from public.customer_invoice_bank_allocations allocation
  where allocation.financial_transaction_id = transaction.id
    and allocation.reversed_at is null
) allocation on true
where transaction.transaction_type = 'income'
  and not transaction.is_transfer
  and transaction.category = 'Painting revenue'
  and transaction.amount > coalesce(allocation.allocated_amount, 0) + 0.005

union all

select
  'supplier-line:' || line.id,
  'supplier_invoice_line',
  null,
  null,
  'labour_invoice_line',
  line.id::text,
  line.amount_before_tax,
  'Supplier invoice line needs a documented job allocation',
  'needs_review'
from public.labour_invoice_lines line
join ranked_invoices invoice
  on invoice.id = line.invoice_id and invoice.version_rank = 1
left join public.labour_invoice_line_allocations allocation
  on allocation.invoice_line_id = line.id
where allocation.invoice_line_id is null
  and invoice.match_status <> 'overhead_unmatched'

union all

select
  'material-line:' || line.id,
  'material_invoice_line',
  null,
  null,
  'material_invoice_line',
  line.id::text,
  line.total_amount,
  'Material invoice line needs a job or general-supplies allocation',
  'needs_review'
from public.material_invoice_lines line
left join public.material_invoice_line_allocations allocation
  on allocation.material_invoice_line_id = line.id
 and allocation.reversed_at is null
where allocation.id is null;

create or replace function public.read_job_accounting_reconciliation(
  p_companycam_project_id text default null
)
returns setof public.job_accounting_reconciliation
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if session_user <> 'postgres'
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and public.current_employee_role() not in ('admin', 'manager') then
    raise exception 'Accounting reconciliation requires manager access';
  end if;

  return query
  select job.*
  from public.job_accounting_reconciliation job
  where p_companycam_project_id is null
     or job.companycam_project_id = p_companycam_project_id;
end;
$$;

create or replace function public.read_customer_invoice_reconciliation()
returns setof public.job_customer_invoice_reconciliation
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if session_user <> 'postgres'
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and public.current_employee_role() not in ('admin', 'manager') then
    raise exception 'Customer invoice reconciliation requires manager access';
  end if;

  return query
  select invoice.*
  from public.job_customer_invoice_reconciliation invoice;
end;
$$;

alter table public.labour_contractor_tax_registrations enable row level security;

drop policy if exists "Managers can read contractor tax registrations"
  on public.labour_contractor_tax_registrations;
create policy "Managers can read contractor tax registrations"
  on public.labour_contractor_tax_registrations for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can insert contractor tax registrations"
  on public.labour_contractor_tax_registrations;
create policy "Managers can insert contractor tax registrations"
  on public.labour_contractor_tax_registrations for insert to authenticated
  with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can update contractor tax registrations"
  on public.labour_contractor_tax_registrations;
create policy "Managers can update contractor tax registrations"
  on public.labour_contractor_tax_registrations for update to authenticated
  using (public.current_employee_role() in ('admin', 'manager'))
  with check (public.current_employee_role() in ('admin', 'manager'));

grant select, insert, update
  on public.labour_contractor_tax_registrations to authenticated;
grant select on public.job_accounting_identity to authenticated;
grant select on public.job_customer_invoice_reconciliation to authenticated;
grant select on public.job_supplier_invoice_reconciliation to authenticated;
grant select on public.job_material_invoice_reconciliation to authenticated;
grant select on public.job_accounting_reconciliation to authenticated;
grant select on public.accounting_reconciliation_exceptions to authenticated;
revoke all on function public.read_job_accounting_reconciliation(text)
  from public, anon;
revoke all on function public.read_customer_invoice_reconciliation()
  from public, anon;
grant execute on function public.read_job_accounting_reconciliation(text)
  to authenticated, service_role;
grant execute on function public.read_customer_invoice_reconciliation()
  to authenticated, service_role;

comment on table public.labour_contractor_tax_registrations is
  'Effective-dated evidence of whether a subcontractor may charge GST/HST; invoice tax remains preserved independently.';
comment on view public.job_accounting_reconciliation is
  'Shared job accounting truth used by Jobs, Marketing, and Financials without replacing source invoices or bank evidence.';
comment on view public.accounting_reconciliation_exceptions is
  'One queue for missing job, invoice, bank, supplier-line, material-line, and tax-evidence connections.';

select pg_notify('pgrst', 'reload schema');

commit;
