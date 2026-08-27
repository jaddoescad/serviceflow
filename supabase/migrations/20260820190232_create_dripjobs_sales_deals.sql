begin;

set local lock_timeout = '15s';
set local statement_timeout = '15min';

create table public.dripjobs_sales_deals (
  deal_id text primary key,
  dripjobs_contact_id text,
  lead_id uuid references public.leads(id) on delete set null,
  source_document_id uuid not null references public.documents(id) on delete restrict,
  source_view text not null check (source_view in ('active', 'archived')),
  sales_status text not null,
  label text,
  customer_name text not null,
  email text,
  phone text,
  normalized_email text,
  normalized_phone text,
  raw_source text,
  normalized_channel text not null default 'unknown',
  deal_name text not null,
  deal_stage text not null,
  deal_amount_cents bigint not null default 0 check (deal_amount_cents >= 0),
  last_change text,
  deal_age text,
  salesperson text,
  estimated_created_at timestamptz,
  created_at_method text,
  created_at_confidence numeric(4,3) check (
    created_at_confidence is null or
    (created_at_confidence >= 0 and created_at_confidence <= 1)
  ),
  captured_at timestamptz not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  combined_source_sha256 text not null check (combined_source_sha256 ~ '^[0-9a-f]{64}$'),
  source_row_number integer not null check (source_row_number > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dripjobs_sales_deals_view_stage_idx
  on public.dripjobs_sales_deals(source_view, deal_stage);
create index dripjobs_sales_deals_contact_idx
  on public.dripjobs_sales_deals(dripjobs_contact_id)
  where dripjobs_contact_id is not null;
create index dripjobs_sales_deals_lead_idx
  on public.dripjobs_sales_deals(lead_id)
  where lead_id is not null;
create index dripjobs_sales_deals_channel_created_idx
  on public.dripjobs_sales_deals(normalized_channel, estimated_created_at desc);

alter table public.dripjobs_sales_deals enable row level security;

create policy "authenticated_read"
  on public.dripjobs_sales_deals for select to authenticated
  using ((select auth.uid()) is not null);

grant select on public.dripjobs_sales_deals to authenticated;
grant select, insert, update on public.dripjobs_sales_deals to service_role;

comment on table public.dripjobs_sales_deals is
  'Lossless one-row-per-Deal-ID DripJobs Sales List mirror. Lead links are exact-identity only; unmatched historical deals remain available for reporting.';
comment on column public.dripjobs_sales_deals.estimated_created_at is
  'Approximation derived from the relative Deal Age shown at capture time; use captured_at and confidence when reporting it.';

select pg_notify('pgrst', 'reload schema');

commit;
