-- Canonical marketing source data from DripJobs list exports and monthly Meta
-- Marketing API reports. Raw source rows stay preserved for auditability;
-- dashboard metrics read only canonical rows and never infer bank spend.

create table if not exists public.marketing_crm_records (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'dripjobs',
  record_type text not null,
  source_filename text not null,
  source_sha256 text not null,
  source_row_number integer not null,
  record_fingerprint text not null,
  canonical_in_snapshot boolean not null default true,
  snapshot_on date not null,
  status text not null,
  label text,
  contact_name text,
  email text,
  phone text,
  contact_key text not null,
  raw_lead_source text,
  normalized_channel text not null,
  deal_name text,
  deal_stage text,
  salesperson text,
  deal_amount numeric(14,2) not null default 0,
  proposal_id text,
  invoice_id text,
  invoice_status text,
  paid_amount numeric(14,2) not null default 0,
  balance_amount numeric(14,2) not null default 0,
  raw_last_change text,
  raw_deal_age text,
  estimated_lead_created_on date,
  lead_date_method text not null,
  lead_date_confidence numeric(5,4) not null default 0,
  source_payload jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_crm_record_type_check check (
    record_type in ('sales_deal', 'job')
  ),
  constraint marketing_crm_channel_check check (
    normalized_channel in (
      'paid_social',
      'organic_social',
      'website',
      'phone',
      'mail',
      'referral',
      'organic_search',
      'other',
      'unknown'
    )
  ),
  constraint marketing_crm_lead_date_method_check check (
    lead_date_method in (
      'attribution_exact',
      'deal_age_day',
      'deal_age_month',
      'sales_cycle_model',
      'unknown'
    )
  ),
  constraint marketing_crm_confidence_check check (
    lead_date_confidence >= 0 and lead_date_confidence <= 1
  ),
  constraint marketing_crm_hash_check check (
    source_sha256 ~ '^[0-9a-f]{64}$'
    and record_fingerprint ~ '^[0-9a-f]{64}$'
    and contact_key ~ '^[0-9a-f]{64}$'
  ),
  constraint marketing_crm_row_check check (source_row_number > 1),
  constraint marketing_crm_source_unique unique (
    source_sha256,
    source_row_number
  )
);

create index if not exists marketing_crm_snapshot_idx
  on public.marketing_crm_records(snapshot_on, canonical_in_snapshot);
create index if not exists marketing_crm_created_idx
  on public.marketing_crm_records(
    estimated_lead_created_on,
    normalized_channel
  ) where canonical_in_snapshot;
create index if not exists marketing_crm_contact_idx
  on public.marketing_crm_records(contact_key);
create index if not exists marketing_crm_proposal_idx
  on public.marketing_crm_records(proposal_id)
  where proposal_id is not null;

create table if not exists public.marketing_platform_monthly_performance (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'meta',
  account_id text not null,
  account_name text not null,
  currency text not null,
  month_start date not null,
  purpose text not null,
  campaign_id text not null,
  campaign_name text not null,
  spend numeric(14,2) not null default 0,
  leads numeric(14,4) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  source_filename text not null,
  source_sha256 text not null,
  source_row_number integer not null,
  source_payload jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_platform_monthly_platform_check check (
    platform = 'meta'
  ),
  constraint marketing_platform_monthly_currency_check check (
    currency in ('CAD', 'USD')
  ),
  constraint marketing_platform_monthly_purpose_check check (
    purpose in ('customer_acquisition', 'recruiting', 'other')
  ),
  constraint marketing_platform_monthly_amounts_check check (
    spend >= 0 and leads >= 0 and impressions >= 0 and reach >= 0
  ),
  constraint marketing_platform_monthly_hash_check check (
    source_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint marketing_platform_monthly_row_check check (
    source_row_number > 1
  ),
  constraint marketing_platform_monthly_source_unique unique (
    source_sha256,
    source_row_number
  )
);

create index if not exists marketing_platform_monthly_period_idx
  on public.marketing_platform_monthly_performance(
    month_start,
    account_id,
    purpose
  );

drop trigger if exists marketing_crm_records_set_updated_at
  on public.marketing_crm_records;
create trigger marketing_crm_records_set_updated_at
before update on public.marketing_crm_records
for each row execute function public.set_updated_at();

drop trigger if exists marketing_platform_monthly_set_updated_at
  on public.marketing_platform_monthly_performance;
create trigger marketing_platform_monthly_set_updated_at
before update on public.marketing_platform_monthly_performance
for each row execute function public.set_updated_at();

alter table public.marketing_crm_records enable row level security;
alter table public.marketing_platform_monthly_performance enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'marketing_crm_records',
    'marketing_platform_monthly_performance'
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

grant select, insert, update on public.marketing_crm_records to authenticated;
grant select, insert, update
  on public.marketing_platform_monthly_performance to authenticated;

comment on table public.marketing_crm_records is
  'Immutable DripJobs sales-list and jobs-list source rows with canonical duplicate markers and explicit lead-date estimation evidence.';
comment on table public.marketing_platform_monthly_performance is
  'Monthly campaign delivery from the Meta Marketing API in each ad account native currency.';

select pg_notify('pgrst', 'reload schema');
