-- Make DripJobs proposal identity explicit on every direct job-cost allocation.
-- CompanyCam project IDs remain supporting operational evidence and may be
-- reused; they are no longer the accounting join key.

begin;

create table if not exists public.job_project_links (
  id uuid primary key default gen_random_uuid(),
  job_proposal_id text not null
    references public.dripjobs_jobs(proposal_id) on delete restrict,
  companycam_project_id text not null
    references public.companycam_projects(companycam_id) on delete restrict,
  link_role text not null default 'supporting',
  link_status text not null default 'suggested',
  match_method text not null,
  confidence numeric(4,3) not null,
  evidence jsonb not null default '{}'::jsonb,
  review_note text,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_project_links_pair_unique
    unique (job_proposal_id, companycam_project_id),
  constraint job_project_links_role_check check (
    link_role in ('canonical', 'supporting')
  ),
  constraint job_project_links_status_check check (
    link_status in ('suggested', 'confirmed', 'rejected')
  ),
  constraint job_project_links_method_check check (
    match_method in (
      'synthetic_project_id',
      'customer_invoice_project',
      'confirmed_lead_bridge',
      'project_budget_proposal',
      'unique_exact_name',
      'exact_name_and_date',
      'manual'
    )
  ),
  constraint job_project_links_confidence_check check (
    confidence between 0 and 1
  ),
  constraint job_project_links_confirmation_check check (
    link_status <> 'confirmed' or confirmed_at is not null
  )
);

create index if not exists job_project_links_job_idx
  on public.job_project_links(job_proposal_id, link_status);
create index if not exists job_project_links_project_idx
  on public.job_project_links(companycam_project_id, link_status);
create unique index if not exists job_project_links_one_canonical_idx
  on public.job_project_links(job_proposal_id)
  where link_role = 'canonical' and link_status = 'confirmed';

drop trigger if exists job_project_links_set_updated_at
  on public.job_project_links;
create trigger job_project_links_set_updated_at
before update on public.job_project_links
for each row execute function public.set_updated_at();

create table if not exists public.job_cost_allocation_links (
  id uuid primary key default gen_random_uuid(),
  allocation_key text not null unique,
  cost_type text not null,
  labour_invoice_line_id uuid
    references public.labour_invoice_lines(id) on delete restrict,
  material_line_allocation_id uuid
    references public.material_invoice_line_allocations(id) on delete restrict,
  companycam_project_id text not null
    references public.companycam_projects(companycam_id) on delete restrict,
  job_proposal_id text not null
    references public.dripjobs_jobs(proposal_id) on delete restrict,
  match_method text not null,
  confidence numeric(4,3) not null,
  evidence jsonb not null default '{}'::jsonb,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_cost_allocation_links_type_check check (
    (
      cost_type = 'labour'
      and labour_invoice_line_id is not null
      and material_line_allocation_id is null
      and allocation_key =
        'labour:' || labour_invoice_line_id::text || ':' || companycam_project_id
    )
    or
    (
      cost_type = 'material'
      and labour_invoice_line_id is null
      and material_line_allocation_id is not null
      and allocation_key = 'material:' || material_line_allocation_id::text
    )
  ),
  constraint job_cost_allocation_links_method_check check (
    match_method in (
      'synthetic_project_id',
      'customer_invoice_project',
      'confirmed_lead_bridge',
      'project_budget_proposal',
      'unique_exact_name',
      'exact_name_and_date',
      'manual'
    )
  ),
  constraint job_cost_allocation_links_confidence_check check (
    confidence between 0 and 1
  )
);

create index if not exists job_cost_allocation_links_job_idx
  on public.job_cost_allocation_links(job_proposal_id, cost_type);
create index if not exists job_cost_allocation_links_labour_idx
  on public.job_cost_allocation_links(
    labour_invoice_line_id,
    companycam_project_id
  ) where cost_type = 'labour';
create index if not exists job_cost_allocation_links_material_idx
  on public.job_cost_allocation_links(material_line_allocation_id)
  where cost_type = 'material';

drop trigger if exists job_cost_allocation_links_set_updated_at
  on public.job_cost_allocation_links;
create trigger job_cost_allocation_links_set_updated_at
before update on public.job_cost_allocation_links
for each row execute function public.set_updated_at();

-- Safe deterministic seed: synthetic project IDs are exact proposal IDs.
insert into public.job_project_links (
  job_proposal_id,
  companycam_project_id,
  link_role,
  link_status,
  match_method,
  confidence,
  evidence,
  review_note,
  confirmed_at
)
select
  job.proposal_id,
  project.companycam_id,
  'canonical',
  'confirmed',
  'synthetic_project_id',
  1,
  jsonb_build_object(
    'source', 'migration_exact_synthetic_project_id',
    'proposal_id', job.proposal_id
  ),
  'Exact synthetic DripJobs project ID.',
  now()
from public.dripjobs_jobs job
join public.companycam_projects project
  on project.companycam_id = 'dripjobs-' || job.proposal_id
on conflict (job_proposal_id, companycam_project_id) do update set
  link_role = excluded.link_role,
  link_status = excluded.link_status,
  match_method = excluded.match_method,
  confidence = excluded.confidence,
  evidence = excluded.evidence,
  review_note = excluded.review_note,
  confirmed_at = excluded.confirmed_at;

-- A job may have several operational projects, but accounting uses exactly one
-- DripJobs proposal. Prefer the explicit canonical link in shared views.
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
  coalesce(canonical.companycam_project_id, invoice_identity.companycam_project_id)
    as companycam_project_id,
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
  select link.companycam_project_id
  from public.job_project_links link
  where link.job_proposal_id = job.proposal_id
    and link.link_role = 'canonical'
    and link.link_status = 'confirmed'
  limit 1
) canonical on true
left join lateral (
  select
    count(*) as invoice_count,
    count(distinct invoice.companycam_project_id)
      filter (where invoice.companycam_project_id is not null) as project_count,
    min(invoice.companycam_project_id) as companycam_project_id
  from public.customer_invoices invoice
  where trim(coalesce(invoice.external_proposal_id, '')) = job.proposal_id
    and invoice.accounting_status <> 'void'
) invoice_identity on true;

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
    cost_identity.job_proposal_id,
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
  left join public.job_cost_allocation_links cost_identity
    on cost_identity.cost_type = 'labour'
   and cost_identity.labour_invoice_line_id = allocation.invoice_line_id
   and cost_identity.companycam_project_id = allocation.companycam_project_id
  where invoice.version_rank = 1
  group by
    cost_identity.job_proposal_id,
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
  coalesce(allocated.job_proposal_id, legacy_identity.job_proposal_id)
    as job_proposal_id,
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
left join public.job_accounting_identity legacy_identity
  on allocated.job_proposal_id is null
 and legacy_identity.companycam_project_id = allocated.companycam_project_id
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
  coalesce(cost_identity.job_proposal_id, legacy_identity.job_proposal_id)
    as job_proposal_id,
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
left join public.job_cost_allocation_links cost_identity
  on cost_identity.cost_type = 'material'
 and cost_identity.material_line_allocation_id = allocation.id
left join public.job_accounting_identity legacy_identity
  on cost_identity.job_proposal_id is null
 and legacy_identity.companycam_project_id = allocation.companycam_project_id
left join public.material_invoice_verification verification
  on verification.material_invoice_id = invoice.id
where allocation.reversed_at is null
  and allocation.allocation_scope = 'job'
group by
  allocation.companycam_project_id,
  cost_identity.job_proposal_id,
  legacy_identity.job_proposal_id,
  invoice.id,
  invoice.supplier_name,
  invoice.invoice_number,
  invoice.invoice_date,
  invoice.currency,
  verification.verification_status,
  verification.payment_count,
  verification.paid_amount,
  verification.amount_remaining;

create or replace view public.job_cost_allocation_identity_exceptions
with (security_invoker = true)
as
select
  'labour'::text as cost_type,
  allocation.invoice_line_id as allocation_id,
  allocation.companycam_project_id,
  allocation.allocated_amount::numeric(14,2) as amount_before_hst,
  allocation.needs_review,
  'Direct labour allocation has no DripJobs proposal identity'::text as reason
from public.labour_invoice_line_allocations allocation
left join public.job_cost_allocation_links cost_identity
  on cost_identity.cost_type = 'labour'
 and cost_identity.labour_invoice_line_id = allocation.invoice_line_id
 and cost_identity.companycam_project_id = allocation.companycam_project_id
where cost_identity.id is null

union all

select
  'material'::text,
  allocation.id,
  allocation.companycam_project_id,
  allocation.allocated_before_tax::numeric(14,2),
  allocation.needs_review,
  'Direct material allocation has no DripJobs proposal identity'::text
from public.material_invoice_line_allocations allocation
left join public.job_cost_allocation_links cost_identity
  on cost_identity.cost_type = 'material'
 and cost_identity.material_line_allocation_id = allocation.id
where allocation.reversed_at is null
  and allocation.allocation_scope = 'job'
  and cost_identity.id is null;

alter table public.job_project_links enable row level security;
alter table public.job_cost_allocation_links enable row level security;

drop policy if exists "Managers can read job_project_links"
  on public.job_project_links;
create policy "Managers can read job_project_links"
  on public.job_project_links for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can insert job_project_links"
  on public.job_project_links;
create policy "Managers can insert job_project_links"
  on public.job_project_links for insert to authenticated
  with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can update job_project_links"
  on public.job_project_links;
create policy "Managers can update job_project_links"
  on public.job_project_links for update to authenticated
  using (public.current_employee_role() in ('admin', 'manager'))
  with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can read job_cost_allocation_links"
  on public.job_cost_allocation_links;
create policy "Managers can read job_cost_allocation_links"
  on public.job_cost_allocation_links for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can insert job_cost_allocation_links"
  on public.job_cost_allocation_links;
create policy "Managers can insert job_cost_allocation_links"
  on public.job_cost_allocation_links for insert to authenticated
  with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can update job_cost_allocation_links"
  on public.job_cost_allocation_links;
create policy "Managers can update job_cost_allocation_links"
  on public.job_cost_allocation_links for update to authenticated
  using (public.current_employee_role() in ('admin', 'manager'))
  with check (public.current_employee_role() in ('admin', 'manager'));

grant select, insert, update on public.job_project_links to authenticated;
grant select, insert, update on public.job_cost_allocation_links to authenticated;
grant select on public.job_cost_allocation_identity_exceptions to authenticated;

comment on table public.job_project_links is
  'Auditable DripJobs-proposal to operational-project evidence. Direct costs still carry their proposal ID explicitly.';
comment on table public.job_cost_allocation_links is
  'Immutable direct-cost evidence linked explicitly to one canonical DripJobs proposal without rewriting the source allocation.';
comment on view public.job_cost_allocation_identity_exceptions is
  'Completeness control: direct costs that would otherwise disappear from proposal-level job costing.';

select pg_notify('pgrst', 'reload schema');

commit;
