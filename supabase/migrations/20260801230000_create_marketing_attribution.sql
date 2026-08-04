-- Evidence-backed marketing attribution.
--
-- DripJobs remains the source for the customer's recorded lead source and
-- Meta exports remain the source for platform delivery. Bank transactions are
-- not replaced: they stay the accounting evidence for cash advertising cost.

create extension if not exists pgcrypto;

create table if not exists public.customer_invoice_acquisition_attributions (
  customer_invoice_id uuid primary key
    references public.customer_invoices(id) on delete restrict,
  source_system text not null default 'dripjobs',
  external_contact_id text not null,
  raw_lead_source text not null,
  normalized_channel text not null,
  lead_created_at timestamptz,
  evidence_source text not null,
  evidence_reference text not null,
  evidence_payload jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_invoice_acquisition_channel_check check (
    normalized_channel in (
      'paid_social',
      'organic_social',
      'website',
      'phone',
      'mail',
      'referral',
      'other',
      'unknown'
    )
  ),
  constraint customer_invoice_acquisition_evidence_check check (
    evidence_source in ('dripjobs_contact_page', 'dripjobs_sales_list')
  ),
  constraint customer_invoice_acquisition_reference_check check (
    length(trim(evidence_reference)) > 0
  )
);

create index if not exists customer_invoice_acquisition_contact_idx
  on public.customer_invoice_acquisition_attributions(
    source_system,
    external_contact_id
  );
create index if not exists customer_invoice_acquisition_channel_idx
  on public.customer_invoice_acquisition_attributions(
    normalized_channel,
    lead_created_at
  );

create table if not exists public.marketing_platform_performance (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  account_id text not null,
  entity_level text not null,
  entity_name text not null,
  parent_campaign_name text,
  parent_ad_set_name text,
  delivery_state text,
  purpose text not null,
  reporting_start date not null,
  reporting_end date not null,
  currency text not null default 'CAD',
  results numeric(14,4),
  result_indicator text,
  amount_spent numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  source_filename text not null,
  source_sha256 text not null,
  source_row_number integer not null,
  source_payload jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_platform_performance_platform_check check (
    platform in ('meta')
  ),
  constraint marketing_platform_performance_level_check check (
    entity_level in ('campaign', 'ad_set', 'ad')
  ),
  constraint marketing_platform_performance_purpose_check check (
    purpose in ('customer_acquisition', 'recruiting', 'other')
  ),
  constraint marketing_platform_performance_currency_check check (
    currency in ('CAD', 'USD')
  ),
  constraint marketing_platform_performance_period_check check (
    reporting_end >= reporting_start
  ),
  constraint marketing_platform_performance_amounts_check check (
    amount_spent >= 0 and impressions >= 0 and reach >= 0
  ),
  constraint marketing_platform_performance_hash_check check (
    source_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint marketing_platform_performance_row_check check (
    source_row_number > 1
  ),
  constraint marketing_platform_performance_source_unique unique (
    source_sha256,
    source_row_number
  )
);

create index if not exists marketing_platform_performance_period_idx
  on public.marketing_platform_performance(
    platform,
    purpose,
    reporting_start,
    reporting_end
  );
create index if not exists marketing_platform_performance_entity_idx
  on public.marketing_platform_performance(
    platform,
    entity_level,
    entity_name
  );

drop trigger if exists customer_invoice_acquisition_set_updated_at
  on public.customer_invoice_acquisition_attributions;
create trigger customer_invoice_acquisition_set_updated_at
before update on public.customer_invoice_acquisition_attributions
for each row execute function public.set_updated_at();

drop trigger if exists marketing_platform_performance_set_updated_at
  on public.marketing_platform_performance;
create trigger marketing_platform_performance_set_updated_at
before update on public.marketing_platform_performance
for each row execute function public.set_updated_at();

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
) payment on true;

alter table public.customer_invoice_acquisition_attributions enable row level security;
alter table public.marketing_platform_performance enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customer_invoice_acquisition_attributions',
    'marketing_platform_performance'
  ] loop
    execute format(
      'drop policy if exists "Managers can read %1$s" on public.%1$I',
      table_name
    );
    execute format(
      'create policy "Managers can read %1$s" on public.%1$I for select to authenticated using (public.current_employee_role() in (''admin'', ''manager''))',
      table_name
    );
    execute format(
      'drop policy if exists "Managers can insert %1$s" on public.%1$I',
      table_name
    );
    execute format(
      'create policy "Managers can insert %1$s" on public.%1$I for insert to authenticated with check (public.current_employee_role() in (''admin'', ''manager''))',
      table_name
    );
    execute format(
      'drop policy if exists "Managers can update %1$s" on public.%1$I',
      table_name
    );
    execute format(
      'create policy "Managers can update %1$s" on public.%1$I for update to authenticated using (public.current_employee_role() in (''admin'', ''manager'')) with check (public.current_employee_role() in (''admin'', ''manager''))',
      table_name
    );
  end loop;
end $$;

grant select, insert, update
  on public.customer_invoice_acquisition_attributions to authenticated;
grant select, insert, update
  on public.marketing_platform_performance to authenticated;
grant select on public.customer_invoice_marketing_attribution to authenticated;

comment on table public.customer_invoice_acquisition_attributions is
  'Primary acquisition evidence copied from DripJobs and linked to the source customer invoice/job.';
comment on table public.marketing_platform_performance is
  'Immutable source rows imported from ad-platform exports; bank transactions remain the accounting cash evidence.';
comment on view public.customer_invoice_marketing_attribution is
  'Job-level booked and bank-backed revenue grouped with preserved customer acquisition evidence.';

select pg_notify('pgrst', 'reload schema');
