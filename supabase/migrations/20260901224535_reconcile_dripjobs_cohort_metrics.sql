-- Reconcile exact DripJobs monthly contacts, Sales, and proposal cohorts.
begin;

set local lock_timeout = '15s';
set local statement_timeout = '15min';

create or replace view public.dripjobs_lead_report_latest
with (security_invoker = true)
as
with accepted_documents as (
  select
    document.id,
    document.captured_at,
    document.created_at,
    case
      when document.metadata ->> 'first_created_on' ~ '^\d{4}-\d{2}-\d{2}$'
        then (document.metadata ->> 'first_created_on')::date
      else null
    end as first_created_on,
    case
      when document.metadata ->> 'last_created_on' ~ '^\d{4}-\d{2}-\d{2}$'
        then (document.metadata ->> 'last_created_on')::date
      else null
    end as last_created_on
  from public.documents document
  where document.kind = 'dripjobs_lead_report'
    and document.metadata ->> 'validation_status' = 'accepted'
)
select report.*
from public.dripjobs_lead_report_rows report
join accepted_documents source_document
  on source_document.id = report.source_document_id
where not exists (
  select 1
  from accepted_documents newer_document
  where (
      newer_document.captured_at,
      newer_document.created_at,
      newer_document.id
    ) > (
      source_document.captured_at,
      source_document.created_at,
      source_document.id
    )
    and newer_document.first_created_on is not null
    and newer_document.last_created_on is not null
    and newer_document.first_created_on <= newer_document.last_created_on
    and report.created_on between
      newer_document.first_created_on and newer_document.last_created_on
);

revoke all on public.dripjobs_lead_report_latest
  from public, anon, authenticated, service_role;
grant select on public.dripjobs_lead_report_latest to authenticated, service_role;

create view public.dripjobs_sales_report_metrics
with (security_invoker = true)
as
with latest_snapshots as (
  select distinct on (snapshot.period_start, snapshot.period_end)
    snapshot.id,
    snapshot.period_start,
    snapshot.period_end,
    snapshot.sales_count,
    snapshot.gross_sales_cents,
    snapshot.source_rows,
    snapshot.captured_at
  from public.dripjobs_sales_report_snapshots snapshot
  where snapshot.metadata ->> 'validation_status' = 'accepted'
  order by
    snapshot.period_start,
    snapshot.period_end,
    snapshot.captured_at desc,
    snapshot.created_at desc,
    snapshot.id desc
),
expanded as (
  select
    snapshot.id,
    snapshot.period_start,
    snapshot.period_end,
    snapshot.sales_count,
    snapshot.gross_sales_cents,
    snapshot.captured_at,
    source_row.value as source_row,
    case
      when coalesce(source_row.value ->> 'total_value_cents', '') ~ '^[0-9]+$'
        then (source_row.value ->> 'total_value_cents')::bigint
      else null
    end as source_gross_sales_cents,
    case
      when lower(btrim(coalesce(source_row.value ->> 'lead_source', ''))) in (
        'meta-perspective',
        'meta ads'
      ) then true
      when lower(btrim(coalesce(source_row.value ->> 'lead_source', ''))) like 'meta ads -%'
        then true
      else false
    end as is_paid_social
  from latest_snapshots snapshot
  left join lateral jsonb_array_elements(snapshot.source_rows) source_row(value)
    on true
)
select
  expanded.period_start,
  expanded.period_end,
  expanded.sales_count,
  expanded.gross_sales_cents,
  coalesce(
    sum(round(expanded.source_gross_sales_cents::numeric / 1.13)),
    0
  )::bigint as pre_hst_sales_cents,
  count(*) filter (
    where expanded.source_row is not null
      and expanded.is_paid_social
  )::integer as paid_social_sales_count,
  coalesce(
    sum(expanded.source_gross_sales_cents) filter (
      where expanded.is_paid_social
    ),
    0
  )::bigint as paid_social_gross_sales_cents,
  coalesce(
    sum(round(expanded.source_gross_sales_cents::numeric / 1.13)) filter (
      where expanded.is_paid_social
    ),
    0
  )::bigint as paid_social_pre_hst_sales_cents,
  expanded.captured_at
from expanded
group by
  expanded.id,
  expanded.period_start,
  expanded.period_end,
  expanded.sales_count,
  expanded.gross_sales_cents,
  expanded.captured_at;

revoke all on public.dripjobs_sales_report_metrics
  from public, anon, authenticated, service_role;
grant select on public.dripjobs_sales_report_metrics to authenticated, service_role;

create table public.dripjobs_closing_ratio_snapshot_rows (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.dripjobs_closing_ratio_snapshots(id) on delete restrict,
  source_row_number integer not null check (source_row_number between 1 and 10000),
  row_sha256 text not null check (row_sha256 ~ '^[0-9a-f]{64}$'),
  dripjobs_job_id text not null check (dripjobs_job_id ~ '^[0-9a-f]{20,80}$'),
  dripjobs_contact_id text not null check (dripjobs_contact_id ~ '^[0-9a-f]{20,80}$'),
  proposal_id text check (proposal_id is null or proposal_id ~ '^[0-9]{1,20}$'),
  sent_on date not null check (sent_on >= date '2000-01-01'),
  raw_source text not null check (
    btrim(raw_source) = raw_source
    and char_length(raw_source) <= 500
  ),
  normalized_channel text not null check (
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
  appointment_linked boolean not null,
  report_status text not null check (
    btrim(report_status) = report_status
    and char_length(report_status) between 1 and 40
  ),
  acceptance_method text not null check (
    acceptance_method in ('none', 'signed', 'no_signature', 'on_site')
  ),
  is_accepted boolean not null,
  proposal_value_cents bigint not null check (proposal_value_cents >= 0),
  delivery_method text not null check (
    btrim(delivery_method) = delivery_method
    and char_length(delivery_method) between 1 and 80
  ),
  created_at timestamptz not null default now(),
  constraint dripjobs_closing_ratio_row_acceptance_check check (
    is_accepted = (acceptance_method <> 'none')
  ),
  constraint dripjobs_closing_ratio_row_number_unique
    unique (snapshot_id, source_row_number),
  constraint dripjobs_closing_ratio_row_fingerprint_unique
    unique (snapshot_id, row_sha256),
  constraint dripjobs_closing_ratio_row_job_unique
    unique (snapshot_id, dripjobs_job_id)
);

alter table public.dripjobs_closing_ratio_snapshot_rows enable row level security;

create policy "manager_read"
  on public.dripjobs_closing_ratio_snapshot_rows for select to authenticated
  using ((select private.is_manager()));

revoke all on public.dripjobs_closing_ratio_snapshot_rows
  from public, anon, authenticated, service_role;
grant select on public.dripjobs_closing_ratio_snapshot_rows to authenticated;
grant select, insert on public.dripjobs_closing_ratio_snapshot_rows to service_role;

create view public.dripjobs_closing_ratio_row_metrics
with (security_invoker = true)
as
with reconciled_snapshots as (
  select
    snapshot.id,
    snapshot.period_start,
    snapshot.period_end,
    snapshot.qualified_proposals_count,
    snapshot.accepted_proposals_count,
    count(*) filter (where row.appointment_linked)::integer
      as appointment_linked_proposals_count,
    count(*) filter (
      where row.appointment_linked and row.is_accepted
    )::integer as appointment_linked_accepted_count,
    count(*) filter (
      where row.normalized_channel = 'paid_social'
    )::integer as paid_social_proposals_count,
    count(*) filter (
      where row.normalized_channel = 'paid_social' and row.is_accepted
    )::integer as paid_social_accepted_count,
    snapshot.captured_at,
    snapshot.created_at
  from public.dripjobs_closing_ratio_snapshots snapshot
  join public.dripjobs_closing_ratio_snapshot_rows row
    on row.snapshot_id = snapshot.id
  where snapshot.metadata ->> 'validation_status' = 'accepted'
  group by
    snapshot.id,
    snapshot.period_start,
    snapshot.period_end,
    snapshot.qualified_proposals_count,
    snapshot.accepted_proposals_count,
    snapshot.captured_at,
    snapshot.created_at
  having count(*) = snapshot.qualified_proposals_count
    and count(*) filter (where row.is_accepted) = snapshot.accepted_proposals_count
),
latest_reconciled as (
  select distinct on (snapshot.period_start, snapshot.period_end)
    snapshot.*
  from reconciled_snapshots snapshot
  order by
    snapshot.period_start,
    snapshot.period_end,
    snapshot.captured_at desc,
    snapshot.created_at desc,
    snapshot.id desc
)
select
  snapshot.id as snapshot_id,
  snapshot.period_start,
  snapshot.period_end,
  snapshot.qualified_proposals_count,
  snapshot.accepted_proposals_count,
  snapshot.appointment_linked_proposals_count,
  snapshot.appointment_linked_accepted_count,
  snapshot.paid_social_proposals_count,
  snapshot.paid_social_accepted_count,
  snapshot.captured_at
from latest_reconciled snapshot;

revoke all on public.dripjobs_closing_ratio_row_metrics
  from public, anon, authenticated, service_role;
grant select on public.dripjobs_closing_ratio_row_metrics to authenticated, service_role;

comment on view public.dripjobs_sales_report_metrics is
  'Privacy-safe monthly DripJobs Sales aggregates from the latest accepted source-row snapshot. Pre-HST values divide and round each sale independently.';
comment on view public.dripjobs_lead_report_latest is
  'Accepted DripJobs lead-report rows overlaid by captured time: a newer accepted document replaces older rows only inside its declared first_created_on through last_created_on coverage.';
comment on view public.marketing_lead_facts is
  'Dashboard-safe lead and appointment facts from period-overlaid accepted DripJobs reports. Filter marketing_eligible for CPL/CAC denominators.';
comment on column public.dripjobs_sales_report_metrics.gross_sales_cents is
  'Pipeline plus manual-invoice sales including HST, exactly as reported by DripJobs.';
comment on column public.dripjobs_sales_report_metrics.pre_hst_sales_cents is
  'Sum of round(source-row gross cents / 1.13); HST is removed per sale before summing.';
comment on table public.dripjobs_closing_ratio_snapshot_rows is
  'Append-only, non-PII row evidence for a validated DripJobs qualified-proposal cohort.';
comment on column public.dripjobs_closing_ratio_snapshot_rows.row_sha256 is
  'SHA-256 of the normalized non-PII evidence fields for this source row.';
comment on column public.dripjobs_closing_ratio_snapshot_rows.is_accepted is
  'True when acceptance_method is signed, no_signature, or on_site. Report status is a separate workflow state and is not acceptance authority.';
comment on view public.dripjobs_closing_ratio_row_metrics is
  'Latest accepted DripJobs cohort per period, returned only when child row and accepted counts reconcile exactly to the parent snapshot.';

select pg_notify('pgrst', 'reload schema');

commit;
